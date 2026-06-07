use chrono::Utc;
use sqlx::SqlitePool;
use std::process::Command;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

pub async fn start_window_tracker(sqlx_connection_pool: SqlitePool) {
    let mut last_logged_window_title = String::new();

    loop {
        // Get the active app name first — this requires no permissions.
        // Only attempt the window title (which needs Accessibility) if that succeeds.
        if let Some(active_app_name) = get_frontmost_app_name() {
            // Window title is best-effort: requires Accessibility permission.
            // If unavailable, we fall back to the app name so the app-switch
            // event is still captured regardless of permission state.
            let effective_window_title = get_frontmost_window_title()
                .unwrap_or_else(|| active_app_name.clone());

            let is_non_empty = !effective_window_title.is_empty();
            let is_new_window = effective_window_title != last_logged_window_title;

            if is_non_empty && is_new_window {
                last_logged_window_title = effective_window_title.clone();

                let new_event_id = Uuid::new_v4().to_string();
                let event_timestamp_milliseconds = Utc::now().timestamp_millis();

                let insert_result = sqlx::query(
                    "INSERT INTO events (id, timestamp, type, raw_content, app_name, url, source)
                     VALUES (?, ?, 'window', ?, ?, NULL, 'rust')",
                )
                .bind(&new_event_id)
                .bind(event_timestamp_milliseconds)
                .bind(&effective_window_title)
                .bind(&active_app_name)
                .execute(&sqlx_connection_pool)
                .await;

                if let Err(database_error) = insert_result {
                    eprintln!("Failed to write window event to SQLite: {database_error}");
                }
            }
        }

        sleep(Duration::from_secs(30)).await;
    }
}

// Returns the display name of the frontmost application (e.g. "Google Chrome").
// Uses `path to frontmost application` + Finder's `info for`, which requires
// no Accessibility or Screen Recording permission on any macOS version.
fn get_frontmost_app_name() -> Option<String> {
    run_osascript(
        "tell application \"Finder\" to return name of \
         (info for (path to frontmost application))",
    )
}

// Returns the title of the front window of the active application.
// Requires Accessibility permission — returns None silently when unavailable
// so the caller can fall back to the app name.
fn get_frontmost_window_title() -> Option<String> {
    run_osascript(
        "tell application \"System Events\" to get title of front window of \
         (first application process whose frontmost is true)",
    )
}

// Runs a single-line AppleScript expression and returns trimmed stdout,
// or None if the command fails or produces no output.
fn run_osascript(applescript_expression: &str) -> Option<String> {
    let command_output = Command::new("osascript")
        .arg("-e")
        .arg(applescript_expression)
        .output();

    match command_output {
        Ok(output) if output.status.success() => {
            let trimmed_output = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();

            if trimmed_output.is_empty() {
                None
            } else {
                Some(trimmed_output)
            }
        }
        Ok(_failed_output) => {
            // Silently swallow failures — System Events errors when Accessibility
            // is not granted are expected in dev and are handled by the caller.
            None
        }
        Err(io_error) => {
            eprintln!("Failed to spawn osascript process: {io_error}");
            None
        }
    }
}
