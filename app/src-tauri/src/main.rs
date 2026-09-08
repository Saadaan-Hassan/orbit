// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous};
use std::str::FromStr;

// FastAPI subprocess management is only needed in dev mode.
// In release builds the backend runs as a bundled PyInstaller sidecar spawned
// via tauri-plugin-shell in lib.rs instead.
#[cfg(debug_assertions)]
use std::process::{Child, Command, Stdio};
#[cfg(debug_assertions)]
use std::sync::{Arc, Mutex};

#[cfg(debug_assertions)]
/// Resolves the absolute path to the `uv` executable.
///
/// When Tauri spawns a child process the inherited PATH is the minimal
/// system PATH, not the user's full shell PATH. `uv` is typically installed
/// in one of the locations below, none of which are in the system PATH.
/// We check them in order and fall back to the bare name so the system PATH
/// is tried last (covers custom installs via Homebrew or nix).
fn resolve_uv_executable_path() -> String {
    let home_directory = std::env::var("HOME").unwrap_or_default();

    let candidate_paths = [
        format!("{}/.local/bin/uv", home_directory),   // official install script default
        format!("{}/.cargo/bin/uv", home_directory),   // cargo install uv
        "/opt/homebrew/bin/uv".to_string(),             // Homebrew on Apple Silicon
        "/usr/local/bin/uv".to_string(),                // Homebrew on Intel / manual
        "/usr/bin/uv".to_string(),                      // system package manager
    ];

    for candidate_path in &candidate_paths {
        if std::path::Path::new(candidate_path).exists() {
            return candidate_path.clone();
        }
    }

    // Last resort — rely on whatever PATH the child process inherits.
    "uv".to_string()
}

#[cfg(debug_assertions)]
fn spawn_fastapi_backend(backend_directory_path: &str, session_token: &str) -> Child {
    let uv_executable_path = resolve_uv_executable_path();

    Command::new(&uv_executable_path)
        .args(["run", "uvicorn", "main:app", "--port", "47821", "--no-access-log"])
        .current_dir(backend_directory_path)
        // This avoids disclosure through process arguments, URLs, and normal
        // access logs. The token is never written to persistent storage.
        .env("ORBIT_LOCAL_API_SESSION_TOKEN", session_token)
        // Inherit stdout and stderr so FastAPI logs appear in the same terminal.
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap_or_else(|spawn_error| {
            panic!(
                "Failed to spawn FastAPI backend using `{}`: {}. \
                 Ensure `uv` is installed (https://docs.astral.sh/uv/getting-started/installation/).",
                uv_executable_path, spawn_error
            )
        })
}

fn main() {
    // Build an explicit multi-threaded tokio runtime instead of using
    // #[tokio::main] — Tauri's event loop must block the main thread, and
    // an explicit runtime lets spawned tasks keep running while it does.
    let tokio_runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio async runtime");

    let home_directory_path = std::env::var("HOME")
        .expect("HOME environment variable must be set");

    let orbit_directory_path = format!("{}/.orbit", home_directory_path);

    std::fs::create_dir_all(&orbit_directory_path)
        .expect("Failed to create ~/.orbit directory");

    let orbit_database_file_path = format!("{}/orbit.db", orbit_directory_path);

    let sqlx_connection_pool = tokio_runtime
        .block_on(async {
            let sqlite_connect_options =
                SqliteConnectOptions::from_str(&format!("sqlite:{}", orbit_database_file_path))
                    .expect("Failed to parse SQLite connection string")
                    .create_if_missing(true)
                    .journal_mode(SqliteJournalMode::Wal)
                    .synchronous(SqliteSynchronous::Normal)
                    .busy_timeout(std::time::Duration::from_secs(5));

            sqlx::SqlitePool::connect_with(sqlite_connect_options).await
        })
        .expect("Failed to open SQLite connection pool");

    // Ensure the events table exists with the full schema so all capture
    // modules can write immediately, before FastAPI runs create_all_tables().
    // Must match database.py's DDL exactly — adding a column here requires
    // a corresponding ALTER TABLE migration in _migrate_schema().
    tokio_runtime
        .block_on(async {
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS events (
                    id              TEXT PRIMARY KEY,
                    timestamp       INTEGER NOT NULL,
                    type            TEXT NOT NULL,
                    raw_content     TEXT,
                    app_name        TEXT,
                    url             TEXT,
                    source          TEXT NOT NULL,
                    session_id      TEXT,
                    category        TEXT,
                    page_text       TEXT,
                    link_target     TEXT,
                    metadata        TEXT,
                    file_path       TEXT,
                    is_user_active  INTEGER,
                    screen_text     TEXT
                )",
            )
            .execute(&sqlx_connection_pool)
            .await
        })
        .expect("Failed to create events table in SQLite");

    tokio_runtime.spawn(capture::clipboard::start_clipboard_monitor(
        orbit_database_file_path.clone(),
        sqlx_connection_pool.clone(),
    ));

    tokio_runtime.spawn(capture::file_activity::start_file_activity_monitor(
        sqlx_connection_pool.clone(),
        orbit_database_file_path,
    ));

    tokio_runtime.spawn(capture::system_state::start_system_state_monitor(
        sqlx_connection_pool.clone(),
    ));

    // unified_poller replaces three separate osascript polling tasks:
    // app_lifecycle (10s), window (30s), and browser_url (5s).
    // All three are now driven by a single 8-second combined osascript.
    tokio_runtime.spawn(capture::unified_poller::start_unified_poller(
        sqlx_connection_pool.clone(),
    ));

    tokio_runtime.spawn(capture::screen_content::start_screen_content_monitor(
        sqlx_connection_pool,
    ));

    // Enter the runtime context so Tauri's internal async commands can use
    // tokio::spawn without needing their own runtime.
    let _tokio_runtime_guard = tokio_runtime.enter();
    let local_api_session_token = app_lib::generate_local_api_session_token();

    // ── Development only: spawn the uv-based FastAPI backend ────────────────
    // In release builds the backend is bundled as a PyInstaller sidecar and
    // spawned by lib.rs via tauri-plugin-shell — no uv required on the user's
    // machine.
    #[cfg(debug_assertions)]
    {
        // CARGO_MANIFEST_DIR is set at compile time to the absolute path of
        // app/src-tauri/. The backend/ folder sits two levels up from there:
        //   app/src-tauri/../../backend  →  orbit/backend/
        let backend_directory_path = std::env::var("ORBIT_BACKEND_PATH")
            .unwrap_or_else(|_| {
                let src_tauri_directory = env!("CARGO_MANIFEST_DIR");
                format!("{}/../../backend", src_tauri_directory)
            });

        // A port collision is handled by the authenticated readiness probe; do
        // not kill or trust an arbitrary process that owns the shared port.
        let fastapi_child_process =
            spawn_fastapi_backend(&backend_directory_path, &local_api_session_token);

        // Wrap the child handle in Arc<Mutex<Option<Child>>> so it can be moved
        // into the Tauri exit hook.
        let fastapi_child_process_handle: Arc<Mutex<Option<Child>>> =
            Arc::new(Mutex::new(Some(fastapi_child_process)));

        // Give the FastAPI server time to bind its port before Tauri initialises
        // and the UI attempts its first backend call.
        std::thread::sleep(std::time::Duration::from_secs(2));

        let fastapi_child_process_handle_for_exit = Arc::clone(&fastapi_child_process_handle);

        app_lib::run_with_exit_hook(local_api_session_token, move || {
            // Kill the FastAPI subprocess cleanly when the Tauri app exits so
            // that port 47821 is not left occupied on subsequent launches.
            if let Ok(mut guard) = fastapi_child_process_handle_for_exit.lock() {
                if let Some(mut child_process) = guard.take() {
                    let kill_result = child_process.kill();
                    if let Err(kill_error) = kill_result {
                        eprintln!("Failed to kill FastAPI backend process: {kill_error}");
                    }
                }
            }
        });
    }

    // ── Production: no FastAPI to manage — sidecar is handled by lib.rs ─────
    #[cfg(not(debug_assertions))]
    app_lib::run_with_exit_hook(local_api_session_token, || {});
}
