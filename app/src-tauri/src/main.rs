// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous};
use std::path::Path;
use std::str::FromStr;

/// Applies owner-only permissions without following an attacker-controlled
/// symlink. This is defence in depth; FileVault remains responsible for
/// encryption at rest on a locked Mac.
fn secure_path_permissions(path: &Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if let Ok(metadata) = std::fs::symlink_metadata(path) {
            if !metadata.file_type().is_symlink() {
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
            }
        }
    }
}

fn prepare_orbit_storage(orbit_directory_path: &str, orbit_database_file_path: &str) {
    std::fs::create_dir_all(orbit_directory_path).expect("Failed to create ~/.orbit directory");
    secure_path_permissions(Path::new(orbit_directory_path), 0o700);

    // SQLite may create these asynchronously when WAL mode is enabled, so
    // this helper runs again after the initial connection/table setup.
    for path in [
        orbit_database_file_path.to_string(),
        format!("{orbit_database_file_path}-wal"),
        format!("{orbit_database_file_path}-shm"),
    ] {
        secure_path_permissions(Path::new(&path), 0o600);
    }
}

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
        format!("{}/.local/bin/uv", home_directory), // official install script default
        format!("{}/.cargo/bin/uv", home_directory), // cargo install uv
        "/opt/homebrew/bin/uv".to_string(),          // Homebrew on Apple Silicon
        "/usr/local/bin/uv".to_string(),             // Homebrew on Intel / manual
        "/usr/bin/uv".to_string(),                   // system package manager
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
fn spawn_fastapi_backend(
    backend_directory_path: &str,
    session_token: &str,
    orbit_database_file_path: &str,
    qdrant_storage_path: &str,
) -> Child {
    let uv_executable_path = resolve_uv_executable_path();

    Command::new(&uv_executable_path)
        .args(["run", "uvicorn", "main:app", "--port", "47821", "--no-access-log"])
        .current_dir(backend_directory_path)
        // This avoids disclosure through process arguments, URLs, and normal
        // access logs. The token is never written to persistent storage.
        .env("ORBIT_LOCAL_API_SESSION_TOKEN", session_token)
        // Keep native capture and the development FastAPI process on one
        // local database/storage root, just like the packaged sidecar.
        .env("ORBIT_DB_PATH", orbit_database_file_path)
        .env("QDRANT_STORAGE_PATH", qdrant_storage_path)
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

#[cfg(debug_assertions)]
/// Kills a stale `uv`/`uvicorn` process left bound to port 47821 from a
/// previous `pnpm tauri dev` session, if one is found.
///
/// `tauri dev`'s file-watcher restarts this binary on every source change by
/// killing the *parent* Rust process externally — that never runs this app's
/// own exit-hook cleanup (which only fires on an in-app quit action), so the
/// FastAPI child it spawned is orphaned, still bound to the port, and blocks
/// every subsequent restart from binding it: the new backend crashes with
/// "address already in use", and the health check keeps hitting the old
/// orphan (whose session token doesn't match the new one), failing with 401
/// forever instead of the real error.
///
/// Only kills a process whose command line actually matches this backend's
/// own known invocation (`uvicorn ... main:app`) — an unrelated process that
/// happens to occupy the port is left alone, matching the existing
/// intentional stance that a port collision with something unrecognized is
/// for the authenticated readiness probe to report, not for this app to
/// resolve by killing an arbitrary process.
fn free_stale_dev_backend_port() {
    let Ok(lsof_output) = Command::new("lsof").args(["-ti", "tcp:47821"]).output() else {
        return;
    };
    if !lsof_output.status.success() {
        return;
    }

    for pid in std::str::from_utf8(&lsof_output.stdout)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.is_empty())
    {
        let Ok(ps_output) = Command::new("ps")
            .args(["-p", pid, "-o", "command="])
            .output()
        else {
            continue;
        };
        let command_line = String::from_utf8_lossy(&ps_output.stdout);
        if command_line.contains("uvicorn") && command_line.contains("main:app") {
            eprintln!(
                "[dev-backend] killing stale backend process {pid} still bound to port 47821"
            );
            let _ = Command::new("kill").args(["-9", pid]).status();
        }
    }
}

fn main() {
    // Build an explicit multi-threaded tokio runtime instead of using
    // #[tokio::main] — Tauri's event loop must block the main thread, and
    // an explicit runtime lets spawned tasks keep running while it does.
    let tokio_runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio async runtime");

    let home_directory_path = std::env::var("HOME").expect("HOME environment variable must be set");

    let orbit_directory_path = format!("{}/.orbit", home_directory_path);

    let orbit_database_file_path = format!("{}/orbit.db", orbit_directory_path);
    let qdrant_storage_path = format!("{}/qdrant_storage", orbit_directory_path);
    prepare_orbit_storage(&orbit_directory_path, &orbit_database_file_path);

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
    prepare_orbit_storage(&orbit_directory_path, &orbit_database_file_path);

    tokio_runtime.spawn(capture::clipboard::start_clipboard_monitor(
        orbit_database_file_path.clone(),
        sqlx_connection_pool.clone(),
    ));

    tokio_runtime.spawn(capture::file_activity::start_file_activity_monitor(
        sqlx_connection_pool.clone(),
        orbit_database_file_path.clone(),
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
        let backend_directory_path = std::env::var("ORBIT_BACKEND_PATH").unwrap_or_else(|_| {
            let src_tauri_directory = env!("CARGO_MANIFEST_DIR");
            format!("{}/../../backend", src_tauri_directory)
        });

        // Clear out our own orphaned backend from a previous dev-mode restart
        // before spawning a fresh one (see free_stale_dev_backend_port's doc
        // comment) — an unrecognized process on the port is left alone, and
        // that remaining collision case is handled by the authenticated
        // readiness probe rather than by killing an arbitrary process.
        free_stale_dev_backend_port();

        let fastapi_child_process = spawn_fastapi_backend(
            &backend_directory_path,
            &local_api_session_token,
            &orbit_database_file_path,
            &qdrant_storage_path,
        );

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
