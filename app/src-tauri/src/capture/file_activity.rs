use chrono::Utc;
use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Path filter
// ---------------------------------------------------------------------------

// Directory names that generate too much noise (generated build artifacts, VCS
// internals, dependency caches). Any path component matching one of these
// causes the entire event to be silently dropped.
const BLOCKED_DIRECTORY_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "__pycache__",
    ".next",
    "dist",
    "build",
    "Library",
    ".cache",
    "venv",
    ".venv",
];

// File suffixes that identify transient or editor-internal files. Events on
// these paths are dropped before any SQLite write.
const BLOCKED_FILE_SUFFIXES: &[&str] = &[".tmp", ".swp", ".lock", ".log"];

/// Returns `true` when the event should be silently dropped.
///
/// Drops events for:
/// - Hidden files/directories: any path component starting with '.'
///   (covers .DS_Store, .gitignore, editor swap files, and hidden dirs like
///   .git, .next, .cache, .venv — they also appear in BLOCKED_DIRECTORY_NAMES
///   for clarity but would be caught by this check alone)
/// - High-noise generated directories: node_modules, target, build, etc.
/// - Transient file suffixes: .tmp, .swp, .lock, .log
fn path_should_be_skipped(file_path: &std::path::Path) -> bool {
    for component in file_path.components() {
        if let std::path::Component::Normal(component_name) = component {
            let component_name_str = component_name.to_string_lossy();
            if component_name_str.starts_with('.') {
                return true;
            }
            if BLOCKED_DIRECTORY_NAMES.contains(&component_name_str.as_ref()) {
                return true;
            }
        }
    }

    if let Some(file_name) = file_path.file_name() {
        let file_name_str = file_name.to_string_lossy();
        for blocked_suffix in BLOCKED_FILE_SUFFIXES {
            if file_name_str.ends_with(blocked_suffix) {
                return true;
            }
        }
    }

    false
}

// ---------------------------------------------------------------------------
// Event kind mapping
// ---------------------------------------------------------------------------

/// Maps a notify `EventKind` to a human-readable action string.
/// Returns `None` for event kinds we don't record (access reads, metadata-only
/// changes, and anything else that doesn't represent a meaningful user action).
fn map_notify_event_kind_to_action_string(event_kind: &notify::EventKind) -> Option<&'static str> {
    match event_kind {
        notify::EventKind::Create(_) => Some("created"),
        notify::EventKind::Modify(_) => Some("modified"),
        notify::EventKind::Remove(_) => Some("removed"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Monitor loop
// ---------------------------------------------------------------------------

/// Watches ~/Documents, ~/Desktop, and ~/Downloads for file system events and
/// writes a `file_activity` event row to SQLite for each non-trivial change.
///
/// A 2-second debounce collapses rapid bursts (e.g. editor auto-saves) into a
/// single event rather than flooding the database. Only the file *path* is
/// stored — file *contents* are never read.
pub async fn start_file_activity_monitor(
    sqlx_connection_pool: SqlitePool,
    sqlite_database_path: String,
) {
    // Bridge between the debouncer's internal sync callback thread and this
    // async tokio task. UnboundedSender is Send so it is safe to call from any
    // thread, including the debouncer's background thread.
    let (debounced_event_sender, mut debounced_event_receiver) =
        mpsc::unbounded_channel::<DebounceEventResult>();

    let debounce_duration = std::time::Duration::from_secs(2);

    let mut file_system_debouncer = match new_debouncer(
        debounce_duration,
        None,
        move |debounce_result: DebounceEventResult| {
            // Ignore send errors — they only occur when the receiver has been
            // dropped, which means the monitor task is shutting down.
            let _ = debounced_event_sender.send(debounce_result);
        },
    ) {
        Ok(debouncer) => debouncer,
        Err(debouncer_creation_error) => {
            eprintln!(
                "File activity monitor: failed to create FSEvents debouncer: \
                 {debouncer_creation_error}"
            );
            return;
        }
    };

    // Register the three user-facing data directories for recursive watching.
    // If a directory does not exist, log the error and continue — we watch
    // whatever directories are available rather than aborting entirely.
    let home_directory = std::env::var("HOME").unwrap_or_default();
    let directories_to_watch = ["Documents", "Desktop", "Downloads"];

    for directory_name in &directories_to_watch {
        let directory_path = format!("{}/{}", home_directory, directory_name);
        if let Err(watch_error) = file_system_debouncer
            .watcher()
            .watch(std::path::Path::new(&directory_path), RecursiveMode::Recursive)
        {
            eprintln!(
                "File activity monitor: could not watch {directory_path}: {watch_error}"
            );
        }
    }

    // file_system_debouncer must remain alive for the duration of this loop.
    // Dropping it would close the debounced_event_sender inside its callback,
    // which would cause debounced_event_receiver.recv() to return None and
    // silently end the monitor. The variable stays in scope until the function
    // returns (which should never happen under normal operation).
    while let Some(debounce_result) = debounced_event_receiver.recv().await {
        let debounced_events = match debounce_result {
            Ok(events) => events,
            Err(watch_errors) => {
                for watch_error in watch_errors {
                    eprintln!("File activity monitor watch error: {watch_error}");
                }
                continue;
            }
        };

        for debounced_event in debounced_events {
            let action = match map_notify_event_kind_to_action_string(&debounced_event.event.kind)
            {
                Some(action_string) => action_string,
                None => continue,
            };

            for file_path in &debounced_event.event.paths {
                if path_should_be_skipped(file_path) {
                    continue;
                }

                let file_name = match file_path.file_name() {
                    Some(name) => name.to_string_lossy().to_string(),
                    None => continue, // No file name component means a bare directory path — skip.
                };

                if file_name.is_empty() {
                    continue;
                }

                let file_path_string = file_path.to_string_lossy().to_string();

                // action is always a static ASCII string ("created" / "modified" /
                // "removed") so inline JSON construction is safe without escaping.
                let metadata_json = format!(r#"{{"action":"{}"}}"#, action);

                let new_event_id = Uuid::new_v4().to_string();
                let event_timestamp_milliseconds = Utc::now().timestamp_millis();

                let insert_result = sqlx::query(
                    "INSERT INTO events \
                         (id, timestamp, type, raw_content, app_name, url, source, \
                          file_path, metadata) \
                     VALUES (?, ?, 'file_activity', ?, NULL, NULL, 'rust', ?, ?)",
                )
                .bind(&new_event_id)
                .bind(event_timestamp_milliseconds)
                .bind(&file_name)
                .bind(&file_path_string)
                .bind(&metadata_json)
                .execute(&sqlx_connection_pool)
                .await;

                if let Err(database_error) = insert_result {
                    eprintln!(
                        "Failed to write file activity event to SQLite \
                         (path: {sqlite_database_path}): {database_error}"
                    );
                }
            }
        }
    }
}
