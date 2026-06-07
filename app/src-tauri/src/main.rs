// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;

use sqlx::sqlite::SqliteConnectOptions;
use std::process::{Child, Command, Stdio};
use std::str::FromStr;
use std::sync::{Arc, Mutex};

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

/// Kills any process already bound to port 8000.
///
/// During Tauri hot-reload the old binary is killed abruptly, which means the
/// exit hook that calls child.kill() never runs. The old FastAPI process stays
/// alive, holds the Qdrant file lock, and causes the new FastAPI spawn to crash
/// on import. Running this before every spawn ensures we always start clean.
fn kill_stale_process_on_port_8000() {
    // `lsof -ti:8000` prints the PID of whatever owns the port, or exits
    // non-zero / prints nothing if the port is free. We pipe straight to
    // `kill` and ignore all errors — if the port is free this is a no-op.
    let _ = Command::new("sh")
        .args(["-c", "lsof -ti:8000 | xargs kill -9 2>/dev/null"])
        .output();

    // Give the OS a moment to release the port and the Qdrant lock file
    // before we start the new FastAPI process.
    std::thread::sleep(std::time::Duration::from_millis(500));
}

fn spawn_fastapi_backend(backend_directory_path: &str) -> Child {
    let uv_executable_path = resolve_uv_executable_path();

    Command::new(&uv_executable_path)
        .args(["run", "uvicorn", "main:app", "--port", "8000"])
        .current_dir(backend_directory_path)
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
    // CARGO_MANIFEST_DIR is set at compile time to the absolute path of
    // app/src-tauri/. The backend/ folder sits two levels up from there:
    //   app/src-tauri/../../backend  →  orbit/backend/
    // Using a compile-time constant avoids any dependency on the working
    // directory of the compiled binary, which changes between dev and release.
    let backend_directory_path = std::env::var("ORBIT_BACKEND_PATH")
        .unwrap_or_else(|_| {
            let src_tauri_directory = env!("CARGO_MANIFEST_DIR");
            format!("{}/../../backend", src_tauri_directory)
        });

    // Evict any stale FastAPI process left over from a previous hot-reload
    // cycle before spawning the new one. This releases the Qdrant file lock
    // that would otherwise cause the new process to crash on startup.
    kill_stale_process_on_port_8000();

    // Spawn the FastAPI backend before the Tauri event loop starts so that
    // the backend is ready to accept capture events as soon as the first
    // window appears.
    let fastapi_child_process = spawn_fastapi_backend(&backend_directory_path);

    // Wrap the child handle in Arc<Mutex<Option<Child>>> so it can be moved
    // into the Tauri on_exit hook, which runs on the main thread.
    let fastapi_child_process_handle: Arc<Mutex<Option<Child>>> =
        Arc::new(Mutex::new(Some(fastapi_child_process)));

    // Give the FastAPI server time to bind its port before Tauri initialises
    // and the UI attempts its first backend call.
    std::thread::sleep(std::time::Duration::from_secs(2));

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
                    .create_if_missing(true);

            sqlx::SqlitePool::connect_with(sqlite_connect_options).await
        })
        .expect("Failed to open SQLite connection pool");

    // Ensure the events table exists so the clipboard monitor can write
    // immediately without waiting for FastAPI to run first.
    tokio_runtime
        .block_on(async {
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS events (
                    id          TEXT PRIMARY KEY,
                    timestamp   INTEGER NOT NULL,
                    type        TEXT NOT NULL,
                    raw_content TEXT,
                    app_name    TEXT,
                    url         TEXT,
                    source      TEXT NOT NULL
                )",
            )
            .execute(&sqlx_connection_pool)
            .await
        })
        .expect("Failed to create events table in SQLite");

    tokio_runtime.spawn(capture::clipboard::start_clipboard_monitor(
        orbit_database_file_path,
        sqlx_connection_pool.clone(),
    ));

    tokio_runtime.spawn(capture::window::start_window_tracker(
        sqlx_connection_pool,
    ));

    // Enter the runtime context so Tauri's internal async commands can use
    // tokio::spawn without needing their own runtime.
    let _tokio_runtime_guard = tokio_runtime.enter();

    // Clone the handle before moving it into the Tauri setup closure.
    let fastapi_child_process_handle_for_exit = Arc::clone(&fastapi_child_process_handle);

    app_lib::run_with_exit_hook(move || {
        // Kill the FastAPI subprocess cleanly when the Tauri app exits so that
        // port 8000 is not left occupied on subsequent launches.
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
