// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;

use sqlx::sqlite::SqliteConnectOptions;
use std::str::FromStr;

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
        sqlx_connection_pool,
    ));

    // Enter the runtime context so Tauri's internal async commands can use
    // tokio::spawn without needing their own runtime.
    let _tokio_runtime_guard = tokio_runtime.enter();

    app_lib::run();
}
