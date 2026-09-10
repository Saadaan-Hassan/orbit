// unified_poller.rs
//
// WHY THIS EXISTS: previously, three separate tokio tasks each spawned their
// own osascript subprocesses at different intervals:
//   window.rs       — 30-second poll  (2/min)
//   browser_url.rs  — 5-second poll   (12/min)
//   app_lifecycle.rs — 10-second poll (6/min)
// That adds up to ~20 osascript spawns per minute, each carrying the fixed
// cost of forking a new process and bootstrapping the AppleScript runtime.
// This module replaces all three with one 8-second poll that runs a single
// combined AppleScript, reducing spawns to ~8/min (~60% reduction).
//
// The three replaced modules (window.rs, browser_url.rs, app_lifecycle.rs)
// are kept on disk for reference but removed from capture/mod.rs.

use super::sanitizer::RedactionPatternCache;
use chrono::Utc;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tokio::process::Command as TokioCommand;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Automation permission flag
//
// Set true on the first poll where osascript signals error -1743
// ("Not authorized to send Apple events") for the active browser.
// Cleared when a subsequent poll successfully reads a browser URL.
// The frontend reads this via check_browser_automation_permission() and
// prompts the user to grant access in System Settings → Automation.
// ---------------------------------------------------------------------------

pub static BROWSER_AUTOMATION_DENIED: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Browser and URL constants (previously in browser_url.rs)
// ---------------------------------------------------------------------------

// Names are also embedded verbatim in UNIFIED_POLL_APPLESCRIPT — both must stay
// in sync. The constant is kept here as the canonical reference and for the
// matching comment in lib.rs (BROWSER_NAMES_FOR_AUTOMATION_PROBE).
#[allow(dead_code)]
const KNOWN_BROWSER_APP_NAMES: &[&str] = &[
    "Google Chrome",
    "Safari",
    "Arc",
    "Brave Browser",
    "Microsoft Edge",
];

// Browser-internal pages are never meaningful memory events.
const INTERNAL_URL_SCHEME_PREFIXES: &[&str] = &[
    "chrome://",
    "about:",
    "safari-resource://",
    "arc://",
    "brave://",
    "edge://",
];

// ---------------------------------------------------------------------------
// Idle detection — inline CoreGraphics call, no subprocess
//
// IDLE TIMER ONLY: CGEventSourceSecondsSinceLastEventType returns the number
// of seconds since the last keyboard or mouse input event. It does NOT
// capture keystrokes, key codes, mouse coordinates, or click targets — it
// is purely a duration measurement used to set is_user_active on window
// events, matching the existing behaviour in window.rs.
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
}

#[cfg(target_os = "macos")]
fn seconds_since_last_user_input() -> f64 {
    // kCGEventSourceStateHIDSystemState = 1: global HID system state.
    // kCGAnyInputEventType = 0xFFFFFFFF: any keyboard or mouse event.
    const HID_SYSTEM_STATE: i32 = 1;
    const ANY_INPUT_EVENT_TYPE: u32 = 0xFFFF_FFFF;
    unsafe { CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT_EVENT_TYPE) }
}

// ---------------------------------------------------------------------------
// Unified capture cache
//
// Consolidates the per-module caches from window.rs, browser_url.rs, and
// app_lifecycle.rs into one struct refreshed once per 30-second window.
// ---------------------------------------------------------------------------

struct UnifiedPollCache {
    is_paused: bool,
    paused_until_ms: Option<i64>,
    excluded_app_names: HashSet<String>,
    excluded_domains: HashSet<String>,
    native_browser_enabled: bool,
    app_window_consent: bool,
    browser_consent: bool,
    redaction_pattern_cache: RedactionPatternCache,
    last_refreshed_at: Instant,
}

impl UnifiedPollCache {
    fn new() -> Self {
        Self {
            is_paused: true,
            paused_until_ms: None,
            excluded_app_names: HashSet::new(),
            excluded_domains: HashSet::new(),
            // Default true so browser capture works from the very first tick,
            // before FastAPI has seeded the browser_capture_settings row.
            native_browser_enabled: false,
            app_window_consent: false,
            browser_consent: false,
            redaction_pattern_cache: RedactionPatternCache::new(),
            // Far in the past so the first iteration always refreshes.
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

    fn app_is_excluded(&self, app_name: &str) -> bool {
        self.excluded_app_names.contains(app_name)
    }

    fn domain_is_excluded(&self, hostname: &str) -> bool {
        self.excluded_domains.contains(hostname)
    }
}

async fn refresh_unified_poll_cache(pool: &SqlitePool, cache: &mut UnifiedPollCache) {
    // Throttle to at most one DB round-trip per 30 seconds.
    if cache.last_refreshed_at.elapsed() < std::time::Duration::from_secs(30) {
        return;
    }

    // --- Pause state ---
    match sqlx::query_as::<_, (i64, Option<i64>)>(
        "SELECT is_paused, paused_until FROM capture_state WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    {
        Ok(Some((is_paused_value, paused_until_value))) => {
            cache.is_paused = is_paused_value != 0;
            cache.paused_until_ms = paused_until_value;
        }
        Ok(None) | Err(_) => {
            cache.is_paused = true;
            cache.paused_until_ms = None;
        }
    }

    // --- Excluded app names ---
    match sqlx::query_as::<_, (String,)>("SELECT app_name FROM excluded_apps")
        .fetch_all(pool)
        .await
    {
        Ok(rows) => {
            cache.excluded_app_names = rows.into_iter().map(|(name,)| name).collect();
        }
        Err(_) => {
            cache.excluded_app_names = HashSet::new();
        }
    }

    // --- Excluded domains ---
    match sqlx::query_as::<_, (String,)>("SELECT domain FROM excluded_domains")
        .fetch_all(pool)
        .await
    {
        Ok(rows) => {
            cache.excluded_domains = rows.into_iter().map(|(domain,)| domain).collect();
        }
        Err(_) => {
            cache.excluded_domains = HashSet::new();
        }
    }

    // --- Native browser capture toggle ---
    match sqlx::query_as::<_, (i64,)>(
        "SELECT native_enabled FROM browser_capture_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    {
        Ok(Some((native_enabled_value,))) => {
            cache.native_browser_enabled = native_enabled_value != 0;
        }
        Ok(None) | Err(_) => {
            cache.native_browser_enabled = false;
        }
    }

    match sqlx::query_as::<_, (i64, i64)>(
        "SELECT COALESCE(accepted_at IS NOT NULL AND app_window = 1, 0), COALESCE(accepted_at IS NOT NULL AND browser = 1, 0) FROM capture_consent WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    {
        Ok(Some((app_window, browser))) => {
            cache.app_window_consent = app_window != 0;
            cache.browser_consent = browser != 0;
        }
        _ => {
            cache.app_window_consent = false;
            cache.browser_consent = false;
        }
    }

    cache.redaction_pattern_cache.refresh_if_stale(pool).await;

    cache.last_refreshed_at = Instant::now();
}

// ---------------------------------------------------------------------------
// Combined AppleScript
//
// Runs once per poll. Returns three line types:
//   APP:<name>|||TITLE:<title>
//   RUNNING:<comma-separated app names>
//   BROWSER_URL:<url>|||BROWSER_TITLE:<title>   (only when a browser is frontmost)
//   BROWSER_ERROR:automation_denied              (only when -1743 fires)
//
// The browser section uses explicit if-else chains rather than
// `tell application (variable)` because AppleScript variable-name targeting
// can misbehave on some macOS versions when the app name contains spaces.
//
// The browser section uses try/on error to surface -1743 as a parseable
// output line rather than letting it abort the script — APP and RUNNING
// lines are already accumulated in outputLines at that point.
// ---------------------------------------------------------------------------

const UNIFIED_POLL_APPLESCRIPT: &str = r#"
set outputLines to ""
set frontAppName to ""

-- Frontmost app name and window title (requires Accessibility permission).
-- Sets frontAppName in outer scope so the browser section can reuse it.
tell application "System Events"
	try
		set frontProc to first application process whose frontmost is true
		set frontAppName to name of frontProc
		set windowTitle to ""
		try
			set windowTitle to title of front window of frontProc
		end try
		set outputLines to outputLines & "APP:" & frontAppName & "|||TITLE:" & windowTitle & linefeed
	end try
end tell

-- Running application names for lifecycle diffing.
tell application "System Events"
	try
		set appList to ""
		repeat with eachName in (name of every application process)
			set appList to appList & eachName & ","
		end repeat
		set outputLines to outputLines & "RUNNING:" & appList & linefeed
	end try
end tell

-- Active browser tab URL and title.
-- Only attempted when the frontmost app is a known browser.
-- try/on error surfaces -1743 as BROWSER_ERROR rather than aborting the script.
set knownBrowserNames to {"Google Chrome", "Safari", "Arc", "Brave Browser", "Microsoft Edge"}
if frontAppName is in knownBrowserNames then
	try
		set browserUrl to ""
		set browserTitle to ""
		if frontAppName is "Safari" then
			tell application "Safari"
				set browserUrl to URL of current tab of front window
				set browserTitle to name of current tab of front window
			end tell
		else if frontAppName is "Google Chrome" then
			tell application "Google Chrome"
				set browserUrl to URL of active tab of front window
				set browserTitle to title of active tab of front window
			end tell
		else if frontAppName is "Arc" then
			tell application "Arc"
				set browserUrl to URL of active tab of front window
				set browserTitle to title of active tab of front window
			end tell
		else if frontAppName is "Brave Browser" then
			tell application "Brave Browser"
				set browserUrl to URL of active tab of front window
				set browserTitle to title of active tab of front window
			end tell
		else if frontAppName is "Microsoft Edge" then
			tell application "Microsoft Edge"
				set browserUrl to URL of active tab of front window
				set browserTitle to title of active tab of front window
			end tell
		end if
		set outputLines to outputLines & "BROWSER_URL:" & browserUrl & "|||BROWSER_TITLE:" & browserTitle & linefeed
	on error errMsg number errNum
		if errNum is -1743 then
			set outputLines to outputLines & "BROWSER_ERROR:automation_denied" & linefeed
		end if
	end try
end if

return outputLines
"#;

// ---------------------------------------------------------------------------
// Poll output — parsed result of one osascript run
// ---------------------------------------------------------------------------

#[derive(Default)]
struct PollOutput {
    app_name: Option<String>,
    window_title: Option<String>,
    browser_url: Option<String>,
    browser_title: Option<String>,
    running_app_names: Vec<String>,
    automation_denied: bool,
}

fn parse_poll_output(raw_output: &str) -> PollOutput {
    let mut result = PollOutput::default();

    for line in raw_output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix("APP:") {
            if let Some((app_part, title_part)) = rest.split_once("|||TITLE:") {
                result.app_name = Some(app_part.trim().to_string());
                result.window_title = Some(title_part.trim().to_string());
            }
        } else if let Some(rest) = line.strip_prefix("BROWSER_URL:") {
            if let Some((url_part, title_part)) = rest.split_once("|||BROWSER_TITLE:") {
                let url = url_part.trim().to_string();
                if !url.is_empty() {
                    result.browser_url = Some(url);
                    result.browser_title = Some(title_part.trim().to_string());
                }
            }
        } else if let Some(rest) = line.strip_prefix("RUNNING:") {
            result.running_app_names = rest
                .split(',')
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(String::from)
                .collect();
        } else if line == "BROWSER_ERROR:automation_denied" {
            result.automation_denied = true;
        }
    }

    result
}

// ---------------------------------------------------------------------------
// Main polling loop
// ---------------------------------------------------------------------------

/// Polls the OS every 8 seconds via a single combined osascript, replacing
/// the three separate polling loops from window.rs (30s), browser_url.rs (5s),
/// and app_lifecycle.rs (10s). All three capture types share one subprocess
/// spawn and one round-trip to the AppleScript runtime per cycle.
pub async fn start_unified_poller(pool: SqlitePool) {
    let mut cache = UnifiedPollCache::new();
    let mut last_window_title = String::new();
    let mut last_browser_url = String::new();

    // Take the initial app list snapshot before the first sleep.
    // This prevents a flood of "launched" events for every app already running
    // when Orbit starts — we only detect apps that launch or quit after this
    // baseline, matching the original app_lifecycle.rs startup behaviour.
    let (initial_output, _initial_stderr) = run_unified_osascript().await;
    let initial_poll = parse_poll_output(&initial_output);
    let mut previous_running_app_names: HashSet<String> = initial_poll
        .running_app_names
        .into_iter()
        .filter(|name| !is_noise_app_name(name))
        .collect();

    loop {
        sleep(Duration::from_secs(8)).await;

        refresh_unified_poll_cache(&pool, &mut cache).await;

        if cache.capture_is_paused_right_now()
            || (!cache.app_window_consent && !cache.browser_consent)
        {
            continue;
        }

        let (raw_output, _stderr) = run_unified_osascript().await;
        let poll = parse_poll_output(&raw_output);

        // ── Idle timer (inline CoreGraphics, no subprocess) ──────────────
        // 1 = user interacted with keyboard or mouse within the last 60 s.
        // 0 = idle. Non-macOS always reports active.
        #[cfg(target_os = "macos")]
        let is_user_active: i64 = if seconds_since_last_user_input() < 60.0 {
            1
        } else {
            0
        };
        #[cfg(not(target_os = "macos"))]
        let is_user_active: i64 = 1;

        // ── Window event ─────────────────────────────────────────────────
        if cache.app_window_consent {
            if let (Some(app_name), Some(window_title)) = (&poll.app_name, &poll.window_title) {
                let is_not_excluded = !cache.app_is_excluded(app_name);
                let title_is_not_empty = !window_title.is_empty();
                let title_has_changed = *window_title != last_window_title;

                if is_not_excluded && title_is_not_empty && title_has_changed {
                    write_window_event(
                        &pool,
                        app_name,
                        window_title,
                        is_user_active,
                        &cache.redaction_pattern_cache,
                    )
                    .await;
                    last_window_title = window_title.clone();
                }
            }
        }

        // ── Browser URL event ────────────────────────────────────────────
        if poll.automation_denied {
            if !BROWSER_AUTOMATION_DENIED.load(Ordering::Relaxed) {
                BROWSER_AUTOMATION_DENIED.store(true, Ordering::Relaxed);
                eprintln!(
                    "Unified poller: Automation permission denied for the active browser. \
                     Grant access in System Settings → Privacy & Security → Automation."
                );
            }
        } else if let Some(browser_url) = &poll.browser_url {
            // A successful read clears any prior denial flag.
            if BROWSER_AUTOMATION_DENIED.load(Ordering::Relaxed) {
                BROWSER_AUTOMATION_DENIED.store(false, Ordering::Relaxed);
            }

            if cache.browser_consent
                && cache.native_browser_enabled
                && !is_internal_browser_url(browser_url)
            {
                // Advance the dedup cursor even for excluded domains, so that
                // navigating from an excluded page to an allowed one is captured.
                if *browser_url != last_browser_url {
                    let hostname = extract_hostname(browser_url);
                    if hostname.is_empty() || !cache.domain_is_excluded(&hostname) {
                        let browser_title = poll.browser_title.as_deref().unwrap_or("");
                        // The app_name from the poll is the browser name when a
                        // browser URL was returned (the browser is frontmost).
                        let browser_app_name = poll.app_name.as_deref().unwrap_or("Chrome");
                        write_browser_url_event(
                            &pool,
                            browser_url,
                            browser_title,
                            browser_app_name,
                            &cache.redaction_pattern_cache,
                        )
                        .await;
                    }
                    last_browser_url = browser_url.clone();
                }
            }
        }

        // ── App lifecycle events ─────────────────────────────────────────
        if cache.app_window_consent && !poll.running_app_names.is_empty() {
            let current_running: HashSet<String> = poll
                .running_app_names
                .into_iter()
                .filter(|name| !is_noise_app_name(name))
                .collect();

            for launched_app_name in current_running.difference(&previous_running_app_names) {
                write_app_lifecycle_event(
                    &pool,
                    launched_app_name,
                    "launched",
                    &cache.redaction_pattern_cache,
                )
                .await;
            }

            for quit_app_name in previous_running_app_names.difference(&current_running) {
                write_app_lifecycle_event(
                    &pool,
                    quit_app_name,
                    "quit",
                    &cache.redaction_pattern_cache,
                )
                .await;
            }

            previous_running_app_names = current_running;
        }
    }
}

// ---------------------------------------------------------------------------
// App name noise filter
//
// Filters names that are not meaningful user-facing applications. These come
// from System Events' "every application process" which includes background
// daemons, framework helpers, and AppleScript-internal stubs.
// ---------------------------------------------------------------------------

fn is_noise_app_name(name: &str) -> bool {
    name.is_empty()
        || name == "missing value"
        || name.starts_with("com.apple.")
        || name.contains("WebKit")
        || name.contains("Helper") // e.g. "Google Chrome Helper", "Claude Helper"
}

// ---------------------------------------------------------------------------
// SQLite write helpers
// ---------------------------------------------------------------------------

async fn write_window_event(
    pool: &SqlitePool,
    app_name: &str,
    window_title: &str,
    is_user_active: i64,
    redaction_pattern_cache: &RedactionPatternCache,
) {
    let event_id = Uuid::new_v4().to_string();
    let timestamp_ms = Utc::now().timestamp_millis();

    if let Err(database_error) = sqlx::query(
        "INSERT INTO events \
             (id, timestamp, type, raw_content, app_name, url, source, is_user_active) \
         VALUES (?, ?, 'window', ?, ?, NULL, 'rust', ?)",
    )
    .bind(&event_id)
    .bind(timestamp_ms)
    .bind(redaction_pattern_cache.sanitize_text(window_title))
    .bind(redaction_pattern_cache.sanitize_text(app_name))
    .bind(is_user_active)
    .execute(pool)
    .await
    {
        eprintln!("Unified poller: failed to write window event: {database_error}");
    }
}

async fn write_browser_url_event(
    pool: &SqlitePool,
    url: &str,
    page_title: &str,
    browser_app_name: &str,
    redaction_pattern_cache: &RedactionPatternCache,
) {
    let event_id = Uuid::new_v4().to_string();
    let timestamp_ms = Utc::now().timestamp_millis();

    if let Err(database_error) = sqlx::query(
        "INSERT INTO events \
             (id, timestamp, type, raw_content, app_name, url, source) \
         VALUES (?, ?, 'url', ?, ?, ?, 'native_browser')",
    )
    .bind(&event_id)
    .bind(timestamp_ms)
    .bind(redaction_pattern_cache.sanitize_text(page_title))
    .bind(redaction_pattern_cache.sanitize_text(browser_app_name))
    .bind(redaction_pattern_cache.sanitize_url(url))
    .execute(pool)
    .await
    {
        eprintln!("Unified poller: failed to write browser URL event: {database_error}");
    }
}

async fn write_app_lifecycle_event(
    pool: &SqlitePool,
    app_name: &str,
    action: &str,
    redaction_pattern_cache: &RedactionPatternCache,
) {
    let event_id = Uuid::new_v4().to_string();
    let timestamp_ms = Utc::now().timestamp_millis();
    // action is always "launched" or "quit" — safe for inline JSON.
    let metadata_json = format!(r#"{{"action":"{}"}}"#, action);

    if let Err(database_error) = sqlx::query(
        "INSERT INTO events \
             (id, timestamp, type, raw_content, app_name, url, source, metadata) \
         VALUES (?, ?, 'app_lifecycle', ?, ?, NULL, 'rust', ?)",
    )
    .bind(&event_id)
    .bind(timestamp_ms)
    .bind(redaction_pattern_cache.sanitize_text(app_name))
    .bind(redaction_pattern_cache.sanitize_text(app_name))
    .bind(&metadata_json)
    .execute(pool)
    .await
    {
        eprintln!(
            "Unified poller: failed to write app_lifecycle '{action}' event \
             for '{app_name}': {database_error}"
        );
    }
}

// ---------------------------------------------------------------------------
// URL helpers (previously in browser_url.rs)
// ---------------------------------------------------------------------------

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
    let hostname_length = after_scheme
        .find(|c: char| c == '/' || c == '?' || c == '#' || c == ':')
        .unwrap_or(after_scheme.len());
    after_scheme[..hostname_length].to_lowercase()
}

// ---------------------------------------------------------------------------
// osascript runner
// ---------------------------------------------------------------------------

/// Runs the combined AppleScript and returns `(stdout, stderr)`.
///
/// Both streams are always returned regardless of exit code so the caller
/// can parse whatever partial output the script produced. Empty strings are
/// returned on spawn failure.
async fn run_unified_osascript() -> (String, String) {
    match TokioCommand::new("osascript")
        .arg("-e")
        .arg(UNIFIED_POLL_APPLESCRIPT)
        .output()
        .await
    {
        Ok(output) => (
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        ),
        Err(io_error) => {
            eprintln!("Unified poller: failed to spawn osascript: {io_error}");
            (String::new(), String::new())
        }
    }
}
