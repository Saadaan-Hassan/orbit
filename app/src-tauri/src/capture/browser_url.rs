use chrono::Utc;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Automation permission flag
//
// Set to true the first time osascript returns error -1743
// ("Not authorized to send Apple events") for any known browser.
// The frontend reads this via a Tauri command and prompts the user to grant
// Automation access in System Settings → Privacy & Security → Automation.
// Cleared automatically if a subsequent poll succeeds (user granted permission).
// ---------------------------------------------------------------------------

pub static BROWSER_AUTOMATION_DENIED: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Known browsers
// ---------------------------------------------------------------------------

// The exact application names macOS uses in osascript dictionaries.
// Any app not in this list is silently ignored even if it is a browser.
const KNOWN_BROWSER_APP_NAMES: &[&str] = &[
    "Google Chrome",
    "Safari",
    "Arc",
    "Brave Browser",
    "Microsoft Edge",
];

// URL scheme prefixes that indicate a browser-internal page. These are never
// meaningful to the user as memory events and are always skipped.
const INTERNAL_URL_SCHEME_PREFIXES: &[&str] = &[
    "chrome://",
    "about:",
    "safari-resource://",
    "arc://",
    "brave://",
    "edge://",
];

// ---------------------------------------------------------------------------
// Capture filter cache
//
// The poll interval is 5 seconds, so cache refreshes are throttled to once
// every 30 seconds to avoid a SQLite SELECT on every iteration.
// ---------------------------------------------------------------------------

struct BrowserUrlCaptureCache {
    is_paused: bool,
    paused_until_ms: Option<i64>,
    excluded_domains: HashSet<String>,
    native_browser_enabled: bool,
    last_refreshed_at: Instant,
}

impl BrowserUrlCaptureCache {
    fn new() -> Self {
        Self {
            is_paused: false,
            paused_until_ms: None,
            excluded_domains: HashSet::new(),
            // Default true so capture works from the very first tick even
            // before the browser_capture_settings row has been seeded by FastAPI.
            native_browser_enabled: true,
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
            None => true,
            Some(until_ms) => Utc::now().timestamp_millis() < until_ms,
        }
    }

    fn domain_is_excluded(&self, hostname: &str) -> bool {
        self.excluded_domains.contains(hostname)
    }
}

async fn refresh_browser_url_capture_cache(
    pool: &SqlitePool,
    cache: &mut BrowserUrlCaptureCache,
) {
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
            cache.is_paused = false;
            cache.paused_until_ms = None;
        }
    }

    // --- Excluded domains ---
    let domain_result =
        sqlx::query_as::<_, (String,)>("SELECT domain FROM excluded_domains")
            .fetch_all(pool)
            .await;

    match domain_result {
        Ok(rows) => {
            cache.excluded_domains = rows.into_iter().map(|(domain,)| domain).collect();
        }
        Err(_) => {
            // excluded_domains table may not exist yet if FastAPI hasn't run.
            // Default to no exclusions rather than blocking all capture.
            cache.excluded_domains = HashSet::new();
        }
    }

    // --- Native browser capture enabled flag ---
    let browser_capture_result = sqlx::query_as::<_, (i64,)>(
        "SELECT native_enabled FROM browser_capture_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await;

    match browser_capture_result {
        Ok(Some((native_enabled_value,))) => {
            cache.native_browser_enabled = native_enabled_value != 0;
        }
        Ok(None) | Err(_) => {
            // Table not yet seeded by FastAPI — default to enabled so capture
            // works from the first launch before the backend has initialised.
            cache.native_browser_enabled = true;
        }
    }

    cache.last_refreshed_at = Instant::now();
}

// ---------------------------------------------------------------------------
// Monitor loop
// ---------------------------------------------------------------------------

/// Polls the active browser tab every 5 seconds via osascript and writes a
/// `type='url'` event to SQLite whenever the URL changes.
///
/// Works for Chrome, Safari, Arc, Brave, and Edge — no browser extension
/// required. Only fires when one of those browsers is the frontmost application.
///
/// File contents are never read. Only the URL and page title are captured.
pub async fn start_native_browser_url_monitor(sqlx_connection_pool: SqlitePool) {
    let mut last_captured_url = String::new();
    let mut capture_cache = BrowserUrlCaptureCache::new();

    loop {
        sleep(Duration::from_secs(5)).await;

        refresh_browser_url_capture_cache(&sqlx_connection_pool, &mut capture_cache).await;

        if capture_cache.capture_is_paused_right_now() {
            continue;
        }

        // Skip the entire poll when the user has disabled native browser capture.
        if !capture_cache.native_browser_enabled {
            continue;
        }

        // Only proceed when a known browser is the active application.
        let frontmost_app_name = match get_frontmost_app_name() {
            Some(name) => name,
            None => continue,
        };

        let browser_name = match KNOWN_BROWSER_APP_NAMES
            .iter()
            .find(|&&known| known == frontmost_app_name.as_str())
            .copied()
        {
            Some(name) => name,
            None => continue,
        };

        // Always attempt the script even after a prior denial — this detects
        // when the user eventually grants Automation permission.
        let active_tab_script = build_active_tab_script(browser_name);
        let (script_stdout, script_stderr) =
            run_osascript_capturing_output(&active_tab_script);

        // Detect Automation permission denial (-1743). Log the first occurrence
        // only; subsequent denials are tracked via BROWSER_AUTOMATION_DENIED
        // without spamming stderr.
        if is_automation_permission_error(&script_stderr) {
            if !BROWSER_AUTOMATION_DENIED.load(Ordering::Relaxed) {
                BROWSER_AUTOMATION_DENIED.store(true, Ordering::Relaxed);
                eprintln!(
                    "Native browser URL capture: Automation permission denied for \
                     {browser_name}. Grant access in System Settings → Privacy & \
                     Security → Automation to enable native browser URL capture."
                );
            }
            continue;
        }

        // Script succeeded — clear the denial flag in case the user just
        // granted permission since the last iteration.
        if BROWSER_AUTOMATION_DENIED.load(Ordering::Relaxed) {
            BROWSER_AUTOMATION_DENIED.store(false, Ordering::Relaxed);
        }

        let raw_script_output = match script_stdout {
            Some(output) => output,
            None => continue,
        };

        // The script returns "url|||title". Split on the sentinel delimiter.
        let (captured_url, captured_title) = match raw_script_output.split_once("|||") {
            Some((url_part, title_part)) => {
                (url_part.trim().to_string(), title_part.trim().to_string())
            }
            None => continue,
        };

        if captured_url.is_empty() {
            continue;
        }

        // Skip internal browser pages (chrome://, about:, arc://, etc.).
        if is_internal_browser_url(&captured_url) {
            continue;
        }

        // Dedup: only write an event when the URL changes.
        if captured_url == last_captured_url {
            continue;
        }

        // Check the excluded-domains list before writing anything to SQLite.
        let url_hostname = extract_hostname(&captured_url);
        if !url_hostname.is_empty() && capture_cache.domain_is_excluded(&url_hostname) {
            // Update the dedup cursor even for excluded domains so that
            // navigating from an excluded page to an allowed page is captured.
            last_captured_url = captured_url;
            continue;
        }

        last_captured_url = captured_url.clone();

        let new_event_id = Uuid::new_v4().to_string();
        let event_timestamp_milliseconds = Utc::now().timestamp_millis();

        let insert_result = sqlx::query(
            "INSERT INTO events \
                 (id, timestamp, type, raw_content, app_name, url, source) \
             VALUES (?, ?, 'url', ?, ?, ?, 'native_browser')",
        )
        .bind(&new_event_id)
        .bind(event_timestamp_milliseconds)
        .bind(&captured_title)
        .bind(browser_name)
        .bind(&captured_url)
        .execute(&sqlx_connection_pool)
        .await;

        if let Err(database_error) = insert_result {
            eprintln!(
                "Native browser URL monitor: failed to write event to SQLite: \
                 {database_error}"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// AppleScript builders
// ---------------------------------------------------------------------------

/// Returns the AppleScript expression that fetches the active tab URL and
/// title for the given browser, joined by the "|||" sentinel.
fn build_active_tab_script(browser_name: &str) -> String {
    if browser_name == "Safari" {
        // Safari's dictionary uses "current tab" and "name" rather than the
        // Chromium-family "active tab" and "title".
        "tell application \"Safari\" to return \
         (URL of current tab of front window) & \"|||\" & \
         (name of current tab of front window)"
            .to_string()
    } else {
        // Google Chrome, Arc, Brave Browser, and Microsoft Edge all share the
        // same Chromium AppleScript dictionary.
        format!(
            "tell application \"{}\" to return \
             (URL of active tab of front window) & \"|||\" & \
             (title of active tab of front window)",
            browser_name
        )
    }
}

// ---------------------------------------------------------------------------
// osascript helpers
// ---------------------------------------------------------------------------

/// Returns the display name of the currently frontmost application.
///
/// Uses the same Finder-based approach as window.rs. Requires no special
/// permissions — not Accessibility, not Automation.
fn get_frontmost_app_name() -> Option<String> {
    let (stdout, _stderr) = run_osascript_capturing_output(
        "tell application \"Finder\" to return name of \
         (info for (path to frontmost application))",
    );
    stdout
}

/// Runs a single AppleScript expression and returns `(trimmed stdout, raw stderr)`.
///
/// Both streams are captured separately so callers can distinguish an
/// Automation permission denial (in stderr with error code -1743) from an
/// ordinary empty result (stdout empty, no stderr error).
fn run_osascript_capturing_output(
    applescript_expression: &str,
) -> (Option<String>, String) {
    let command_result = Command::new("osascript")
        .arg("-e")
        .arg(applescript_expression)
        .output();

    match command_result {
        Ok(output) => {
            let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();

            if output.status.success() {
                let stdout_text = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .to_string();
                let trimmed_stdout = if stdout_text.is_empty() {
                    None
                } else {
                    Some(stdout_text)
                };
                (trimmed_stdout, stderr_text)
            } else {
                (None, stderr_text)
            }
        }
        Err(io_error) => {
            eprintln!(
                "Native browser URL monitor: failed to spawn osascript process: \
                 {io_error}"
            );
            (None, String::new())
        }
    }
}

/// Returns true when osascript stderr indicates Automation permission has not
/// been granted for the target browser application.
///
/// macOS emits error -1743 (errAEEventNotPermitted) when an app tries to
/// send Apple Events to another app that the user has not yet allowed in
/// System Settings → Privacy & Security → Automation.
fn is_automation_permission_error(stderr_output: &str) -> bool {
    stderr_output.contains("Not authorized to send Apple events")
        || stderr_output.contains("-1743")
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/// Returns true for browser-internal URLs that should never be captured.
fn is_internal_browser_url(url: &str) -> bool {
    INTERNAL_URL_SCHEME_PREFIXES
        .iter()
        .any(|prefix| url.starts_with(prefix))
}

/// Extracts the bare hostname from a URL string.
///
/// Handles `https://hostname/path?query` without pulling in the `url` crate.
/// Returns an empty string for anything that does not contain `://`.
fn extract_hostname(url: &str) -> String {
    let after_scheme = match url.find("://") {
        Some(offset) => &url[offset + 3..],
        None => return String::new(),
    };
    // Hostname ends at the first `/`, `?`, `#`, or `:` (port separator).
    let hostname_length = after_scheme
        .find(|character: char| {
            character == '/' || character == '?' || character == '#' || character == ':'
        })
        .unwrap_or(after_scheme.len());
    after_scheme[..hostname_length].to_lowercase()
}
