use chrono::Utc;
use sqlx::SqlitePool;
use std::collections::HashSet;
use tokio::process::Command as TokioCommand;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Monitor loop
// ---------------------------------------------------------------------------

/// Polls the list of running applications every 10 seconds, diffs it against
/// the previous poll, and writes a `app_lifecycle` event for each change.
///
/// Uses osascript to query System Events (the same approach as window.rs) —
/// no Objective-C bindings or new crates required.
///
/// The initial snapshot is taken before the first sleep so that every app
/// already running at startup is treated as a baseline, not a "just launched"
/// event.
pub async fn start_app_lifecycle_monitor(sqlx_connection_pool: SqlitePool) {
    let mut previously_running_app_names = get_running_app_names().await;

    loop {
        sleep(Duration::from_secs(10)).await;

        let currently_running_app_names = get_running_app_names().await;

        // Apps present now but absent before = launched since last poll.
        for app_name in currently_running_app_names.difference(&previously_running_app_names) {
            write_app_lifecycle_event(&sqlx_connection_pool, app_name, "launched").await;
        }

        // Apps absent now but present before = quit since last poll.
        for app_name in previously_running_app_names.difference(&currently_running_app_names) {
            write_app_lifecycle_event(&sqlx_connection_pool, app_name, "quit").await;
        }

        previously_running_app_names = currently_running_app_names;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Writes a single app lifecycle event to SQLite.
async fn write_app_lifecycle_event(pool: &SqlitePool, app_name: &str, action: &str) {
    let event_id = Uuid::new_v4().to_string();
    let event_timestamp_milliseconds = Utc::now().timestamp_millis();
    // action is always "launched" or "quit" — safe for inline JSON.
    let metadata_json = format!(r#"{{"action":"{}"}}"#, action);

    if let Err(database_error) = sqlx::query(
        "INSERT INTO events \
             (id, timestamp, type, raw_content, app_name, url, source, metadata) \
         VALUES (?, ?, 'app_lifecycle', ?, ?, NULL, 'rust', ?)",
    )
    .bind(&event_id)
    .bind(event_timestamp_milliseconds)
    .bind(app_name)
    .bind(app_name)
    .bind(&metadata_json)
    .execute(pool)
    .await
    {
        eprintln!(
            "App lifecycle monitor: failed to write '{action}' event \
             for '{app_name}': {database_error}"
        );
    }
}

/// Returns the set of currently running application process names by querying
/// System Events via osascript. Returns an empty set on any failure — the
/// next poll will retry automatically.
///
/// Uses tokio::process::Command so the 200–800 ms osascript round-trip does
/// not block a tokio worker thread.
async fn get_running_app_names() -> HashSet<String> {
    let osascript_output = TokioCommand::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get name of every application process",
        ])
        .output()
        .await;

    match osascript_output {
        Ok(output) if output.status.success() => {
            let stdout_text = String::from_utf8_lossy(&output.stdout);
            let trimmed = stdout_text.trim();
            if trimmed.is_empty() {
                HashSet::new()
            } else {
                // AppleScript lists are returned as comma-space-separated strings.
                trimmed
                    .split(", ")
                    .filter(|name| {
                        !name.is_empty()
                            && *name != "missing value"
                            && !name.starts_with("com.apple.")
                            && !name.contains("WebKit")
                    })
                    .map(|name| name.to_string())
                    .collect()
            }
        }
        Ok(_failed_output) => HashSet::new(),
        Err(io_error) => {
            eprintln!("App lifecycle monitor: failed to spawn osascript: {io_error}");
            HashSet::new()
        }
    }
}
