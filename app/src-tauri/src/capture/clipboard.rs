use chrono::Utc;
use sqlx::SqlitePool;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

pub async fn start_clipboard_monitor(
    sqlite_database_path: String,
    sqlx_connection_pool: SqlitePool,
) {
    let mut last_seen_clipboard_text = String::new();

    loop {
        // arboard::Clipboard is !Send and cannot be held across .await points,
        // so we create it and read inside spawn_blocking on each poll.
        let clipboard_read_result =
            tokio::task::spawn_blocking(|| match arboard::Clipboard::new() {
                Ok(mut clipboard_handle) => clipboard_handle.get_text().ok(),
                Err(_) => None,
            })
            .await;

        let maybe_clipboard_text = match clipboard_read_result {
            Ok(value) => value,
            Err(join_error) => {
                eprintln!("Clipboard spawn_blocking task failed: {join_error}");
                None
            }
        };

        if let Some(current_clipboard_text) = maybe_clipboard_text {
            let is_non_empty = !current_clipboard_text.is_empty();
            let is_new_content = current_clipboard_text != last_seen_clipboard_text;

            if is_non_empty && is_new_content {
                last_seen_clipboard_text = current_clipboard_text.clone();

                let new_event_id = Uuid::new_v4().to_string();
                let event_timestamp_milliseconds = Utc::now().timestamp_millis();

                let insert_result = sqlx::query(
                    "INSERT INTO events (id, timestamp, type, raw_content, app_name, url, source)
                     VALUES (?, ?, 'clipboard', ?, NULL, NULL, 'rust')",
                )
                .bind(&new_event_id)
                .bind(event_timestamp_milliseconds)
                .bind(&current_clipboard_text)
                .execute(&sqlx_connection_pool)
                .await;

                if let Err(database_error) = insert_result {
                    eprintln!(
                        "Failed to write clipboard event to SQLite (path: {sqlite_database_path}): \
                         {database_error}"
                    );
                }
            }
        }

        sleep(Duration::from_millis(500)).await;
    }
}
