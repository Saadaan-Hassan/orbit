use super::sanitizer::sanitize_text;
use chrono::Utc;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::time::Instant;
use tokio::process::Command as TokioCommand;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Idle detection (macOS only)
//
// IDLE TIMER ONLY — CGEventSourceSecondsSinceLastEventType returns the number
// of seconds elapsed since the last input event (keyboard or mouse). It does
// NOT capture what was typed or clicked: no keystrokes, no key codes, no mouse
// coordinates, no click targets. This is purely a duration measurement used
// to set the is_user_active flag on each window event.
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
}

/// Returns the number of seconds since any keyboard or mouse input was last
/// received from the HID system. Never captures content — only a duration.
#[cfg(target_os = "macos")]
fn seconds_since_last_user_input() -> f64 {
    // kCGEventSourceStateHIDSystemState = 1: query the global HID system state.
    // kCGAnyInputEventType = 0xFFFFFFFF: consider any keyboard or mouse event.
    const HID_SYSTEM_STATE: i32 = 1;
    const ANY_INPUT_EVENT_TYPE: u32 = 0xFFFF_FFFF;
    unsafe { CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT_EVENT_TYPE) }
}

// ---------------------------------------------------------------------------
// Capture filter cache
//
// The window tracker polls every 30 seconds, so we can afford to refresh the
// cache on every iteration — that's only one SELECT every 30 seconds.
//
// capture_state and excluded_apps are both created by FastAPI's lifespan.
// If they don't exist yet (FastAPI still starting up), queries will fail and
// we default to "capturing allowed, no exclusions" so no events are lost.
// ---------------------------------------------------------------------------

struct WindowCaptureCache {
    is_paused: bool,
    paused_until_ms: Option<i64>,
    excluded_app_names: HashSet<String>,
    // Used to enforce the 30-second minimum between refreshes even though the
    // window poll interval is also 30 seconds — guards against drift.
    last_refreshed_at: Instant,
}

impl WindowCaptureCache {
    fn new() -> Self {
        Self {
            is_paused: false,
            paused_until_ms: None,
            excluded_app_names: HashSet::new(),
            // Far in the past so the very first iteration always refreshes.
            last_refreshed_at: Instant::now()
                .checked_sub(std::time::Duration::from_secs(60))
                .unwrap_or_else(Instant::now),
        }
    }

    fn capture_is_paused_right_now(&self) -> bool {
        if !self.is_paused {
            return false;
        }
        match self.paused_until_ms {
            None => true, // Paused indefinitely.
            Some(until_ms) => Utc::now().timestamp_millis() < until_ms,
        }
    }

    fn app_is_excluded(&self, app_name: &str) -> bool {
        self.excluded_app_names.contains(app_name)
    }
}

async fn refresh_window_capture_cache(pool: &SqlitePool, cache: &mut WindowCaptureCache) {
    // Throttle to at most one DB round-trip per 30 seconds.
    if cache.last_refreshed_at.elapsed() < std::time::Duration::from_secs(30) {
        return;
    }

    // --- Pause state ---
    let pause_result = sqlx::query_as::<_, (i64, Option<i64>)>(
        "SELECT is_paused, paused_until FROM capture_state WHERE id = 1",
    )
    .fetch_optional(pool)
    .await;

    match pause_result {
        Ok(Some((is_paused_value, paused_until_value))) => {
            cache.is_paused = is_paused_value != 0;
            cache.paused_until_ms = paused_until_value;
        }
        Ok(None) | Err(_) => {
            // Table absent or empty — default to capturing.
            cache.is_paused = false;
            cache.paused_until_ms = None;
        }
    }

    // --- Excluded apps ---
    let exclude_result = sqlx::query_as::<_, (String,)>("SELECT app_name FROM excluded_apps")
        .fetch_all(pool)
        .await;

    match exclude_result {
        Ok(rows) => {
            cache.excluded_app_names = rows.into_iter().map(|(name,)| name).collect();
        }
        Err(_) => {
            // Table absent — no exclusions active.
            cache.excluded_app_names = HashSet::new();
        }
    }

    cache.last_refreshed_at = Instant::now();
}

// ---------------------------------------------------------------------------
// Window tracking loop
// ---------------------------------------------------------------------------

pub async fn start_window_tracker(sqlx_connection_pool: SqlitePool) {
    let mut last_logged_window_title = String::new();
    let mut capture_cache = WindowCaptureCache::new();

    loop {
        // Refresh pause state and excluded apps list before each poll.
        refresh_window_capture_cache(&sqlx_connection_pool, &mut capture_cache).await;

        // Skip everything if capture is paused.
        if capture_cache.capture_is_paused_right_now() {
            sleep(Duration::from_secs(30)).await;
            continue;
        }

        // Idle timer — computed once per poll and attached to the window event
        // if one fires. 1 = active (input within the last 60 s), 0 = idle.
        // On non-macOS this always defaults to 1 (active).
        #[cfg(target_os = "macos")]
        let is_user_active: i64 = if seconds_since_last_user_input() < 60.0 {
            1
        } else {
            0
        };
        #[cfg(not(target_os = "macos"))]
        let is_user_active: i64 = 1;

        // Get the active app name first — this requires no permissions.
        // Only attempt the window title (which needs Accessibility) if that succeeds.
        if let Some(active_app_name) = get_frontmost_app_name().await {
            // Skip events from excluded apps entirely — nothing is written to
            // SQLite, so excluded apps leave no trace in the activity log.
            if capture_cache.app_is_excluded(&active_app_name) {
                sleep(Duration::from_secs(30)).await;
                continue;
            }

            // Window title is best-effort: requires Accessibility permission.
            // If unavailable, we fall back to the app name so the app-switch
            // event is still captured regardless of permission state.
            let effective_window_title = get_frontmost_window_title()
                .await
                .unwrap_or_else(|| active_app_name.clone());

            let is_non_empty = !effective_window_title.is_empty();
            let is_new_window = effective_window_title != last_logged_window_title;

            if is_non_empty && is_new_window {
                last_logged_window_title = effective_window_title.clone();

                let new_event_id = Uuid::new_v4().to_string();
                let event_timestamp_milliseconds = Utc::now().timestamp_millis();

                let insert_result = sqlx::query(
                    "INSERT INTO events \
                         (id, timestamp, type, raw_content, app_name, url, source, is_user_active) \
                     VALUES (?, ?, 'window', ?, ?, NULL, 'rust', ?)",
                )
                .bind(&new_event_id)
                .bind(event_timestamp_milliseconds)
                .bind(sanitize_text(&effective_window_title))
                .bind(sanitize_text(&active_app_name))
                .bind(is_user_active)
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

// ---------------------------------------------------------------------------
// osascript helpers
// ---------------------------------------------------------------------------

// Returns the display name of the frontmost application (e.g. "Google Chrome").
// Uses `path to frontmost application` + Finder's `info for`, which requires
// no Accessibility or Screen Recording permission on any macOS version.
async fn get_frontmost_app_name() -> Option<String> {
    run_osascript_async(
        "tell application \"Finder\" to return name of \
         (info for (path to frontmost application))",
    )
    .await
}

// Returns the title of the front window of the active application.
// Requires Accessibility permission — returns None silently when unavailable
// so the caller can fall back to the app name.
async fn get_frontmost_window_title() -> Option<String> {
    run_osascript_async(
        "tell application \"System Events\" to get title of front window of \
         (first application process whose frontmost is true)",
    )
    .await
}

// Runs a single-line AppleScript expression and returns trimmed stdout,
// or None if the command fails or produces no output.
//
// Uses tokio::process::Command so the osascript subprocess is spawned
// without blocking a tokio worker thread during the OS round-trip.
async fn run_osascript_async(applescript_expression: &str) -> Option<String> {
    let command_output = TokioCommand::new("osascript")
        .arg("-e")
        .arg(applescript_expression)
        .output()
        .await;

    match command_output {
        Ok(output) if output.status.success() => {
            let trimmed_output = String::from_utf8_lossy(&output.stdout).trim().to_string();

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
