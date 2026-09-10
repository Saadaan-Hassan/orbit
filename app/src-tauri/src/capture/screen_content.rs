use super::exclusion::normalize_app_name;
use super::sanitizer::RedactionPatternCache;
use chrono::Utc;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

// Log AXErrorAPIDisabled once per process lifetime, not on every failed poll.
static AX_API_DISABLED_LOGGED: AtomicBool = AtomicBool::new(false);

// Visible text is truncated to this many Unicode scalar values before storage.
const SCREEN_TEXT_MAX_CHARS: usize = 1_500;

// Traversal limits — keeps the blocking call short and avoids deep UI trees.
const MAX_TRAVERSAL_ELEMENTS: usize = 30;
const MAX_TRAVERSAL_DEPTH: usize = 3;

// ---------------------------------------------------------------------------
// Capture settings cache
// ---------------------------------------------------------------------------

struct ScreenContentCaptureCache {
    is_enabled: bool,
    is_paused: bool,
    paused_until_ms: Option<i64>,
    excluded_app_names: HashSet<String>,
    redaction_pattern_cache: RedactionPatternCache,
    last_refreshed_at: Instant,
}

impl ScreenContentCaptureCache {
    fn new() -> Self {
        Self {
            is_enabled: false,
            is_paused: true,
            paused_until_ms: None,
            excluded_app_names: HashSet::new(),
            redaction_pattern_cache: RedactionPatternCache::new(),
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
}

#[cfg(test)]
mod tests {
    use super::ScreenContentCaptureCache;

    #[test]
    fn missing_screen_settings_start_disabled_and_paused() {
        let cache = ScreenContentCaptureCache::new();
        assert!(!cache.is_enabled);
        assert!(cache.capture_is_paused_right_now());
    }
}

async fn refresh_screen_content_cache(pool: &SqlitePool, cache: &mut ScreenContentCaptureCache) {
    if cache.last_refreshed_at.elapsed() < std::time::Duration::from_secs(5) {
        return;
    }

    // Screen content enabled toggle. Defaults to true if the table hasn't been
    // seeded yet (FastAPI may still be starting).
    let enabled_result =
        sqlx::query_as::<_, (i64,)>("SELECT enabled FROM screen_content_settings WHERE id = 1")
            .fetch_optional(pool)
            .await;
    cache.is_enabled = match enabled_result {
        Ok(Some((v,))) => v != 0,
        _ => false,
    };

    // Global pause state.
    let pause_result = sqlx::query_as::<_, (i64, Option<i64>)>(
        "SELECT is_paused, paused_until FROM capture_state WHERE id = 1",
    )
    .fetch_optional(pool)
    .await;
    match pause_result {
        Ok(Some((paused, until))) => {
            cache.is_paused = paused != 0;
            cache.paused_until_ms = until;
        }
        _ => {
            cache.is_paused = true;
            cache.paused_until_ms = None;
        }
    }

    let consent_result = sqlx::query_as::<_, (i64,)>("SELECT COALESCE(accepted_at IS NOT NULL AND screen_content = 1, 0) FROM capture_consent WHERE id = 1")
        .fetch_optional(pool)
        .await;
    if !matches!(consent_result, Ok(Some((1,)))) {
        cache.is_enabled = false;
    }

    // Excluded apps list.
    let apps_result = sqlx::query_as::<_, (String,)>("SELECT app_name FROM excluded_apps")
        .fetch_all(pool)
        .await;
    cache.excluded_app_names = match apps_result {
        Ok(rows) => rows
            .into_iter()
            .map(|(name,)| normalize_app_name(&name))
            .filter(|name| !name.is_empty())
            .collect(),
        Err(_) => HashSet::new(),
    };

    cache.redaction_pattern_cache.refresh_if_stale(pool).await;

    cache.last_refreshed_at = Instant::now();
}

// ---------------------------------------------------------------------------
// macOS AXUIElement implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod ax {
    use super::super::exclusion::normalize_app_name;
    use std::ffi::{c_void, CStr, CString};

    // AX return codes.
    pub const AX_OK: i32 = 0;
    pub const AX_ERR_API_DISABLED: i32 = -25211;

    // kCFStringEncodingUTF8
    const CF_ENCODING_UTF8: u32 = 0x0800_0100;

    // Accessibility attribute name strings.
    pub const ATTR_FOCUSED_APPLICATION: &str = "AXFocusedApplication";
    pub const ATTR_FOCUSED_UI_ELEMENT: &str = "AXFocusedUIElement";
    pub const ATTR_FOCUSED_WINDOW: &str = "AXFocusedWindow";
    pub const ATTR_ROLE: &str = "AXRole";
    pub const ATTR_VALUE: &str = "AXValue";
    pub const ATTR_TITLE: &str = "AXTitle";
    pub const ATTR_CHILDREN: &str = "AXChildren";

    // Roles that carry user-readable text content.
    pub const ROLE_STATIC_TEXT: &str = "AXStaticText";
    pub const ROLE_TEXT_AREA: &str = "AXTextArea";
    pub const ROLE_TEXT_FIELD: &str = "AXTextField";

    // SECURITY: password fields — skip unconditionally, including during tree
    // traversal. The AX role for a password input on macOS.
    pub const ROLE_SECURE_TEXT_FIELD: &str = "AXSecureTextField";

    // Raw opaque pointer shared by all CF / AX object types.
    pub type RawRef = *mut c_void;

    // ---------------------------------------------------------------------------
    // Framework bindings
    // ---------------------------------------------------------------------------

    #[link(name = "ApplicationServices", kind = "framework")]
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn AXUIElementCreateSystemWide() -> RawRef;
        pub fn AXUIElementCopyAttributeValue(
            element: RawRef,
            attribute: RawRef, // CFStringRef
            value: *mut RawRef,
        ) -> i32;
        pub fn AXUIElementGetTypeID() -> u64;

        pub fn CFGetTypeID(obj: RawRef) -> u64;
        pub fn CFRelease(obj: RawRef);
        pub fn CFStringGetTypeID() -> u64;
        pub fn CFArrayGetTypeID() -> u64;
        pub fn CFArrayGetCount(array: RawRef) -> i64;
        pub fn CFArrayGetValueAtIndex(array: RawRef, idx: i64) -> RawRef;
        pub fn CFStringCreateWithCString(
            allocator: RawRef,
            c_str: *const i8,
            encoding: u32,
        ) -> RawRef;
        pub fn CFStringGetLength(string: RawRef) -> i64;
        pub fn CFStringGetCString(
            string: RawRef,
            buffer: *mut i8,
            buffer_size: i64,
            encoding: u32,
        ) -> bool;
    }

    // ---------------------------------------------------------------------------
    // CF memory guard
    // ---------------------------------------------------------------------------

    // RAII wrapper that releases a CF/AX object when it drops.
    pub struct CFOwned(RawRef);

    impl CFOwned {
        /// Wraps a CF object returned by a "Create" or "Copy" function.
        /// # Safety: `ptr` must be a valid CF object with +1 retain count.
        pub unsafe fn new(ptr: RawRef) -> Option<Self> {
            if ptr.is_null() {
                None
            } else {
                Some(Self(ptr))
            }
        }

        pub fn as_raw(&self) -> RawRef {
            self.0
        }
    }

    impl Drop for CFOwned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    // CFOwned is only ever used within the single blocking thread where it was
    // created — the raw pointer is never actually sent across threads.
    // SAFETY: AXUIElement and CFString objects are immutable after creation and
    // reference-counted; releasing them from any thread is safe.
    unsafe impl Send for CFOwned {}

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    fn make_cf_string(s: &str) -> Option<CFOwned> {
        let c_str = CString::new(s).ok()?;
        let raw = unsafe {
            CFStringCreateWithCString(
                std::ptr::null_mut(),
                c_str.as_ptr() as *const i8,
                CF_ENCODING_UTF8,
            )
        };
        unsafe { CFOwned::new(raw) }
    }

    unsafe fn read_cf_string(cf_str: RawRef) -> Option<String> {
        if cf_str.is_null() {
            return None;
        }
        let len = CFStringGetLength(cf_str);
        if len <= 0 {
            return Some(String::new());
        }
        // Each UTF-16 code unit can expand to at most 4 bytes in UTF-8.
        let buf_size = (len * 4 + 1) as i64;
        let mut buf: Vec<i8> = vec![0i8; buf_size as usize];
        let ok = CFStringGetCString(cf_str, buf.as_mut_ptr(), buf_size, CF_ENCODING_UTF8);
        if !ok {
            return None;
        }
        let cstr = CStr::from_ptr(buf.as_ptr());
        Some(cstr.to_string_lossy().into_owned())
    }

    /// Returns the string value of an AX attribute, or None if absent / not a string.
    unsafe fn get_string_attr(element: RawRef, attr: &str) -> Option<String> {
        let cf_attr = make_cf_string(attr)?;
        let mut value: RawRef = std::ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(element, cf_attr.as_raw(), &mut value);
        if err != AX_OK || value.is_null() {
            return None;
        }
        let _guard = CFOwned::new(value)?;
        if CFGetTypeID(value) != CFStringGetTypeID() {
            return None;
        }
        read_cf_string(value)
    }

    /// Returns an AXUIElement attribute, wrapped in CFOwned for release on drop.
    unsafe fn get_element_attr(element: RawRef, attr: &str) -> Option<CFOwned> {
        let cf_attr = make_cf_string(attr)?;
        let mut value: RawRef = std::ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(element, cf_attr.as_raw(), &mut value);
        if err != AX_OK || value.is_null() {
            return None;
        }
        if CFGetTypeID(value) != AXUIElementGetTypeID() {
            CFRelease(value);
            return None;
        }
        CFOwned::new(value)
    }

    /// Returns the AXChildren CFArray, wrapped in CFOwned.
    unsafe fn get_children_attr(element: RawRef) -> Option<CFOwned> {
        let cf_attr = make_cf_string(ATTR_CHILDREN)?;
        let mut value: RawRef = std::ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(element, cf_attr.as_raw(), &mut value);
        if err != AX_OK || value.is_null() {
            return None;
        }
        if CFGetTypeID(value) != CFArrayGetTypeID() {
            CFRelease(value);
            return None;
        }
        CFOwned::new(value)
    }

    // ---------------------------------------------------------------------------
    // Text collection
    // ---------------------------------------------------------------------------

    /// Recursively collects visible text from an element and its children.
    /// Stops at MAX_TRAVERSAL_DEPTH / MAX_TRAVERSAL_ELEMENTS to bound latency.
    unsafe fn collect_text(element: RawRef, depth: usize, out: &mut String, visited: &mut usize) {
        if *visited >= super::MAX_TRAVERSAL_ELEMENTS || depth > super::MAX_TRAVERSAL_DEPTH {
            return;
        }
        *visited += 1;

        let role = get_string_attr(element, ATTR_ROLE).unwrap_or_default();

        // SECURITY: never read password fields at any depth.
        if role == ROLE_SECURE_TEXT_FIELD {
            return;
        }

        // Text-bearing elements: prefer AXValue, fall back to AXTitle.
        let text = if role == ROLE_STATIC_TEXT || role == ROLE_TEXT_AREA || role == ROLE_TEXT_FIELD
        {
            get_string_attr(element, ATTR_VALUE).or_else(|| get_string_attr(element, ATTR_TITLE))
        } else {
            // Other elements (buttons, groups, etc.): only AXTitle is useful.
            get_string_attr(element, ATTR_TITLE)
        };

        if let Some(t) = text {
            let trimmed = t.trim();
            if !trimmed.is_empty() {
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(trimmed);
            }
        }

        if depth >= super::MAX_TRAVERSAL_DEPTH {
            return;
        }

        if let Some(children) = get_children_attr(element) {
            let count = CFArrayGetCount(children.as_raw());
            for i in 0..count {
                if *visited >= super::MAX_TRAVERSAL_ELEMENTS {
                    break;
                }
                let child = CFArrayGetValueAtIndex(children.as_raw(), i);
                if !child.is_null() && CFGetTypeID(child) == AXUIElementGetTypeID() {
                    collect_text(child, depth + 1, out, visited);
                }
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Public capture types and entry point
    // ---------------------------------------------------------------------------

    pub struct ScreenCapture {
        pub app_name: String,
        pub window_title: String,
        pub screen_text: String,
    }

    pub enum CaptureOutcome {
        Success(Option<ScreenCapture>),
        ApiDisabled,
    }

    /// Performs the full AXUIElement capture on the calling (blocking) thread.
    pub fn capture_screen_content_sync(
        excluded_app_names: &std::collections::HashSet<String>,
    ) -> CaptureOutcome {
        // All AX calls must be in an unsafe block; the function is safe to call
        // from spawn_blocking because it owns every CF object it touches.
        unsafe { capture_unsafe(excluded_app_names) }
    }

    unsafe fn capture_unsafe(
        excluded_app_names: &std::collections::HashSet<String>,
    ) -> CaptureOutcome {
        // Step 2: system-wide element.
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            return CaptureOutcome::Success(None);
        }
        // system_wide is created with +1 retain; release on drop.
        let _system_wide_guard = match CFOwned::new(system_wide) {
            Some(g) => g,
            None => return CaptureOutcome::Success(None),
        };

        // Step 3: focused application element + app name.
        let focused_app = match get_element_attr(system_wide, ATTR_FOCUSED_APPLICATION) {
            Some(v) => v,
            None => return CaptureOutcome::Success(None),
        };
        let app_name = get_string_attr(focused_app.as_raw(), ATTR_TITLE).unwrap_or_default();

        // Step 4: excluded-app check.
        if !app_name.is_empty() && excluded_app_names.contains(&normalize_app_name(&app_name)) {
            return CaptureOutcome::Success(None);
        }

        // Window title from the focused window inside the focused application.
        let window_title = get_element_attr(focused_app.as_raw(), ATTR_FOCUSED_WINDOW)
            .and_then(|win| get_string_attr(win.as_raw(), ATTR_TITLE))
            .unwrap_or_default();

        // Step 5: focused UI element (system-wide shortcut).
        let focused_element = {
            let cf_attr = match make_cf_string(ATTR_FOCUSED_UI_ELEMENT) {
                Some(v) => v,
                None => return CaptureOutcome::Success(None),
            };
            let mut value: RawRef = std::ptr::null_mut();
            let err = AXUIElementCopyAttributeValue(system_wide, cf_attr.as_raw(), &mut value);

            // Step 11: detect AXErrorAPIDisabled (-25211).
            if err == AX_ERR_API_DISABLED {
                return CaptureOutcome::ApiDisabled;
            }
            if err != AX_OK || value.is_null() {
                return CaptureOutcome::Success(None);
            }
            match CFOwned::new(value) {
                Some(v) => v,
                None => return CaptureOutcome::Success(None),
            }
        };

        // Step 6: SECURITY — skip secure text fields unconditionally.
        let focused_role = get_string_attr(focused_element.as_raw(), ATTR_ROLE).unwrap_or_default();
        if focused_role == ROLE_SECURE_TEXT_FIELD {
            return CaptureOutcome::Success(None);
        }

        // Steps 7–8: shallow text traversal starting from the focused element.
        let mut screen_text = String::new();
        let mut visited: usize = 0;
        collect_text(focused_element.as_raw(), 0, &mut screen_text, &mut visited);

        // Step 8: truncate to 1 500 characters.
        if screen_text.chars().count() > super::SCREEN_TEXT_MAX_CHARS {
            screen_text = screen_text
                .chars()
                .take(super::SCREEN_TEXT_MAX_CHARS)
                .collect();
        }

        if screen_text.trim().is_empty() {
            return CaptureOutcome::Success(None);
        }

        CaptureOutcome::Success(Some(ScreenCapture {
            app_name,
            window_title,
            screen_text,
        }))
    }
}

// ---------------------------------------------------------------------------
// Public monitor entry point
// ---------------------------------------------------------------------------

/// Polls the focused application's visible text every 8 seconds via macOS
/// AXUIElement APIs (same Accessibility permission Orbit already holds for
/// window tracking).
///
/// Security guarantees (enforced unconditionally):
/// - AXSecureTextField elements are never read, including during tree traversal.
/// - Excluded apps are skipped before any element attribute is read.
/// - Captured text is truncated to 1 500 characters before storage.
///
/// The blocking AX calls run on a dedicated OS thread via spawn_blocking so
/// the tokio async runtime is never stalled.
pub async fn start_screen_content_monitor(sqlx_connection_pool: SqlitePool) {
    let mut cache = ScreenContentCaptureCache::new();
    let mut last_captured_text = String::new();

    loop {
        sleep(Duration::from_secs(8)).await;

        refresh_screen_content_cache(&sqlx_connection_pool, &mut cache).await;

        if !cache.is_enabled || cache.capture_is_paused_right_now() {
            continue;
        }

        // Clone excluded apps so they can be moved into spawn_blocking.
        let excluded_apps = cache.excluded_app_names.clone();

        // Run blocking AX calls on a dedicated thread.
        #[cfg(target_os = "macos")]
        let blocking_result =
            tokio::task::spawn_blocking(move || ax::capture_screen_content_sync(&excluded_apps))
                .await;

        // Non-macOS: no-op — AX APIs are macOS-only.
        #[cfg(not(target_os = "macos"))]
        {
            let _ = excluded_apps;
            continue;
        }

        #[cfg(target_os = "macos")]
        {
            let outcome = match blocking_result {
                Ok(o) => o,
                Err(_) => continue, // spawn_blocking panicked — skip this tick
            };

            let capture = match outcome {
                ax::CaptureOutcome::ApiDisabled => {
                    // Log once; keep polling silently so capture resumes if
                    // the user grants permission later.
                    if !AX_API_DISABLED_LOGGED.load(Ordering::Relaxed) {
                        AX_API_DISABLED_LOGGED.store(true, Ordering::Relaxed);
                        eprintln!(
                            "Screen content monitor: Accessibility API is disabled. \
                             Grant Accessibility access in System Settings → \
                             Privacy & Security → Accessibility."
                        );
                    }
                    continue;
                }
                ax::CaptureOutcome::Success(None) => continue,
                ax::CaptureOutcome::Success(Some(c)) => {
                    // Permission was (re-)granted — clear the logged flag.
                    if AX_API_DISABLED_LOGGED.load(Ordering::Relaxed) {
                        AX_API_DISABLED_LOGGED.store(false, Ordering::Relaxed);
                    }
                    c
                }
            };

            // Step 9: skip if text hasn't changed meaningfully since last write.
            if capture.screen_text == last_captured_text {
                continue;
            }
            last_captured_text = capture.screen_text.clone();

            // Step 10: write event to SQLite.
            let event_id = Uuid::new_v4().to_string();
            let timestamp_ms = Utc::now().timestamp_millis();

            let insert_result = sqlx::query(
                "INSERT INTO events \
                     (id, timestamp, type, raw_content, app_name, source, screen_text) \
                 VALUES (?, ?, 'screen_content', ?, ?, 'rust', ?)",
            )
            .bind(&event_id)
            .bind(timestamp_ms)
            .bind(
                cache
                    .redaction_pattern_cache
                    .sanitize_text(&capture.window_title),
            )
            .bind(
                cache
                    .redaction_pattern_cache
                    .sanitize_text(&capture.app_name),
            )
            .bind(
                cache
                    .redaction_pattern_cache
                    .sanitize_text(&capture.screen_text),
            )
            .execute(&sqlx_connection_pool)
            .await;

            if let Err(db_error) = insert_result {
                eprintln!("Screen content monitor: failed to write event to SQLite: {db_error}");
            }
        }
    }
}
