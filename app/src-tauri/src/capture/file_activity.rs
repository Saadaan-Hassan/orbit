use super::exclusion::path_is_within_watched_folder;
use super::sanitizer::RedactionPatternCache;
use chrono::Utc;
use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdCache};
use sqlx::SqlitePool;
use std::collections::HashSet;
use tokio::sync::mpsc;
use tokio::time::{interval_at, Duration, Instant};
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
    // Xcode / iOS / Android build artifacts — a single Capacitor/Xcode build
    // can write hundreds of files into these directories in seconds, flooding
    // the session generator with identical low-signal sessions.
    "DerivedData",
    "Pods",
    "xcuserdata",
    "xcshareddata",
    "capacitor-cordova-ios-plugins",
    "capacitor-cordova-android-plugins",
    ".gradle",
    ".android",
    // Capacitor/Ionic native platform directories — `npx cap sync` writes
    // the entire compiled web bundle (HTML, JS, CSS, fonts, images) into
    // these paths in one shot, generating hundreds of file events per build.
    // Blocking the top-level platform dirs catches all sub-paths
    // (assets/public, res/, java/, etc.) without needing to enumerate them.
    "android",
    "ios",
];

// File suffixes that identify transient or editor-internal files. Events on
// these paths are dropped before any SQLite write.
const BLOCKED_FILE_SUFFIXES: &[&str] = &[".tmp", ".swp", ".lock", ".log"];

/// Returns `true` when the event should be silently dropped.
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

fn map_notify_event_kind_to_action_string(event_kind: &notify::EventKind) -> Option<&'static str> {
    match event_kind {
        notify::EventKind::Create(_) => Some("created"),
        notify::EventKind::Modify(_) => Some("modified"),
        notify::EventKind::Remove(_) => Some("removed"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Settings — read from file_watch_settings (written by FastAPI privacy routes)
// ---------------------------------------------------------------------------

struct FileWatchSettings {
    enabled: bool,
    watched_folders: Vec<String>,
}

fn default_file_watch_settings() -> FileWatchSettings {
    FileWatchSettings {
        enabled: false,
        watched_folders: vec![],
    }
}

/// Reads current file-watch settings from SQLite.
///
/// Falls back to the hardcoded defaults if the table or row is absent (e.g.
/// FastAPI hasn't run yet and hasn't created the table).
async fn read_file_watch_settings(pool: &SqlitePool) -> FileWatchSettings {
    let query_result = sqlx::query_as::<_, (i64, String, i64)>(
        "SELECT enabled, watched_folders, COALESCE((SELECT accepted_at IS NOT NULL AND file_activity = 1 FROM capture_consent WHERE id = 1), 0) FROM file_watch_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await;

    match query_result {
        Ok(Some((enabled_flag, folders_json, consent_granted))) => {
            let folders: Vec<String> = serde_json::from_str(&folders_json).unwrap_or_default();
            FileWatchSettings {
                enabled: enabled_flag != 0 && consent_granted != 0,
                watched_folders: folders,
            }
        }
        // Table absent, row absent, or any DB error — use safe defaults.
        _ => default_file_watch_settings(),
    }
}

// ---------------------------------------------------------------------------
// Watcher sync — diffs currently-watched paths against desired and adjusts
// ---------------------------------------------------------------------------

/// Updates the watcher so that `currently_watched` matches the desired set
/// derived from `new_settings`. Paths no longer desired are unwatched; new
/// paths are watched. If `enabled` is false the desired set is empty.
fn sync_watched_folders<T: Watcher, C: FileIdCache>(
    debouncer: &mut Debouncer<T, C>,
    currently_watched: &mut HashSet<String>,
    new_settings: &FileWatchSettings,
) {
    let desired: HashSet<String> = if new_settings.enabled {
        new_settings.watched_folders.iter().cloned().collect()
    } else {
        HashSet::new()
    };

    // Unwatch paths that are no longer desired.
    let to_remove: Vec<String> = currently_watched.difference(&desired).cloned().collect();
    for path in &to_remove {
        if let Err(unwatch_error) = debouncer.unwatch(std::path::Path::new(path.as_str())) {
            eprintln!("File activity monitor: could not unwatch {path}: {unwatch_error}");
        } else {
            currently_watched.remove(path);
        }
    }

    // Watch paths that are newly desired.
    let to_add: Vec<String> = desired.difference(currently_watched).cloned().collect();
    for path in &to_add {
        if let Err(watch_error) = debouncer.watch(
            std::path::Path::new(path.as_str()),
            RecursiveMode::Recursive,
        ) {
            eprintln!("File activity monitor: could not watch {path}: {watch_error}");
        } else {
            currently_watched.insert(path.clone());
        }
    }
}

// ---------------------------------------------------------------------------
// Monitor loop
// ---------------------------------------------------------------------------

/// Watches user-configured folders for file system events, writing a
/// `file_activity` event row to SQLite for each non-trivial change.
///
/// Settings are refreshed from the `file_watch_settings` table every five
/// seconds. Disabling file watching or changing the folder list takes effect
/// within the next refresh cycle. File *contents* are never read.
pub async fn start_file_activity_monitor(
    sqlx_connection_pool: SqlitePool,
    sqlite_database_path: String,
) {
    let mut redaction_pattern_cache = RedactionPatternCache::new();
    let (debounced_event_sender, mut debounced_event_receiver) =
        mpsc::unbounded_channel::<DebounceEventResult>();

    let debounce_duration = std::time::Duration::from_secs(2);

    let mut file_system_debouncer = match new_debouncer(
        debounce_duration,
        None,
        move |debounce_result: DebounceEventResult| {
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

    // Load initial settings and apply them to the watcher.
    let mut active_settings = read_file_watch_settings(&sqlx_connection_pool).await;
    let mut currently_watched: HashSet<String> = HashSet::new();
    sync_watched_folders(
        &mut file_system_debouncer,
        &mut currently_watched,
        &active_settings,
    );

    // Refresh settings every 5 s. Start the first tick 5 s from now so we
    // don't immediately re-read what we just loaded on startup.
    let mut settings_refresh_interval = interval_at(
        Instant::now() + Duration::from_secs(5),
        Duration::from_secs(5),
    );

    // file_system_debouncer must stay in scope for the entire loop — dropping
    // it closes the sender inside the callback, causing recv() to return None.
    loop {
        tokio::select! {
            event_result = debounced_event_receiver.recv() => {
                let debounced_events = match event_result {
                    Some(Ok(events)) => events,
                    Some(Err(watch_errors)) => {
                        for watch_error in watch_errors {
                            eprintln!("File activity monitor watch error: {watch_error}");
                        }
                        continue;
                    }
                    None => break, // channel closed — debouncer was dropped
                };

                redaction_pattern_cache
                    .refresh_if_stale(&sqlx_connection_pool)
                    .await;

                for debounced_event in debounced_events {
                    let action = match map_notify_event_kind_to_action_string(
                        &debounced_event.event.kind,
                    ) {
                        Some(action_string) => action_string,
                        None => continue,
                    };

                    for file_path in &debounced_event.event.paths {
                        if path_should_be_skipped(file_path)
                            || !active_settings.enabled
                            || !path_is_within_watched_folder(
                                file_path,
                                &active_settings.watched_folders,
                            )
                        {
                            continue;
                        }

                        let file_name = match file_path.file_name() {
                            Some(name) => name.to_string_lossy().to_string(),
                            None => continue,
                        };
                        if file_name.is_empty() {
                            continue;
                        }

                        let file_path_string = file_path.to_string_lossy().to_string();
                        let sanitized_file_name = redaction_pattern_cache.sanitize_text(&file_name);
                        let sanitized_file_path = redaction_pattern_cache.sanitize_text(&file_path_string);
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
                        .bind(&sanitized_file_name)
                        .bind(&sanitized_file_path)
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

            _ = settings_refresh_interval.tick() => {
                let new_settings =
                    read_file_watch_settings(&sqlx_connection_pool).await;
                sync_watched_folders(
                    &mut file_system_debouncer,
                    &mut currently_watched,
                    &new_settings,
                );
                active_settings = new_settings;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::default_file_watch_settings;

    #[test]
    fn missing_file_settings_do_not_watch_any_folder() {
        let settings = default_file_watch_settings();
        assert!(!settings.enabled);
        assert!(settings.watched_folders.is_empty());
    }
}
