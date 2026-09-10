use super::sanitizer::RedactionPatternCache;
use chrono::Utc;
use sqlx::SqlitePool;
use std::time::{Duration, SystemTime};
use tokio::time::sleep;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Polls screen lock state every 5 seconds via CGSessionCopyCurrentDictionary
/// and detects sleep/wake via wall-clock time jumps.
///
/// Replaces the previous Darwin notify_register_file_descriptor approach which
/// required a CoreFoundation run loop on the registering thread — a requirement
/// not met in a tokio async context, causing zero events in practice.
///
/// macOS-only: on other platforms this function returns immediately.
pub async fn start_system_state_monitor(sqlx_connection_pool: SqlitePool) {
    #[cfg(target_os = "macos")]
    run_macos_system_state_monitor(sqlx_connection_pool).await;

    #[cfg(not(target_os = "macos"))]
    let _ = sqlx_connection_pool;
}

// ---------------------------------------------------------------------------
// macOS implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
async fn run_macos_system_state_monitor(pool: SqlitePool) {
    let mut previous_locked: Option<bool> = None;
    let mut redaction_pattern_cache = RedactionPatternCache::new();

    loop {
        // Capture wall clock time before sleeping so we can detect if the
        // system suspended during the sleep interval.  SystemTime uses the
        // real-time clock which advances during system sleep, unlike
        // std::time::Instant / tokio::time::Instant which use mach_absolute_time
        // and stop when the machine is suspended.
        let wall_before = SystemTime::now();

        sleep(Duration::from_secs(5)).await;

        // Sleep/wake detection: if more than 30 s of wall time passed while we
        // were sleeping for 5 s, the machine was suspended and just woke.
        if let Ok(wall_elapsed) = SystemTime::now().duration_since(wall_before) {
            if wall_elapsed.as_secs() > 30 {
                let gap_secs = wall_elapsed.as_secs();
                write_system_state_event(
                    &pool,
                    "wake",
                    &format!(r#"{{"state":"wake","gap_seconds":{gap_secs}}}"#),
                    &mut redaction_pattern_cache,
                )
                .await;
            }
        }

        // Lock/unlock detection: CGSessionCopyCurrentDictionary is a
        // CoreGraphics C call.  Run it in spawn_blocking to avoid stalling
        // the async runtime (same pattern as screen_content.rs AX calls).
        let now_locked = tokio::task::spawn_blocking(read_screen_lock_state)
            .await
            .unwrap_or(false);

        match previous_locked {
            None => {
                // First poll — record initial state without emitting an event.
                previous_locked = Some(now_locked);
            }
            Some(was_locked) if was_locked != now_locked => {
                let state = if now_locked { "lock" } else { "unlock" };
                write_system_state_event(
                    &pool,
                    state,
                    &format!(r#"{{"state":"{state}"}}"#),
                    &mut redaction_pattern_cache,
                )
                .await;
                previous_locked = Some(now_locked);
            }
            _ => {} // No change
        }
    }
}

/// Reads the screen lock state from the CoreGraphics session dictionary.
///
/// CGSessionCopyCurrentDictionary() returns a CFDictionary containing session
/// metadata including "CGSSessionScreenIsLocked" (CFBoolean).  All CF memory
/// management is manual here since we use raw extern "C" bindings rather than
/// the core-foundation crate wrappers, keeping this self-contained.
///
/// Returns false on any failure (dictioary unavailable, key absent, etc.).
#[cfg(target_os = "macos")]
fn read_screen_lock_state() -> bool {
    use std::ffi::c_void;

    // Raw CF opaque pointer aliases.  CFDictionary, CFString, CFBoolean, and
    // CFType are all just pointers to opaque C structs on macOS.
    // Declared as *mut to match screen_content.rs and avoid clashing_extern_declarations.
    type CFTypeRef = *mut c_void;
    type CFDictionaryRef = *mut c_void;
    type CFStringRef = *mut c_void;

    // kCFStringEncodingUTF8 = 0x08000100 (from CFString.h).
    const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        // Returns a +1-retained CFDictionary with session information.
        // Caller must CFRelease.
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        // Returns the value for key, or NULL if absent.  Does NOT retain.
        fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;

        // Creates a +1-retained CFString from a C string.  Caller must CFRelease.
        fn CFStringCreateWithCString(
            alloc: *mut c_void,
            c_str: *const i8,
            encoding: u32,
        ) -> CFStringRef;

        // Extracts the Boolean value from a CFBoolean object.
        fn CFBooleanGetValue(boolean: CFTypeRef) -> bool;

        fn CFRelease(cf: CFTypeRef);
    }

    unsafe {
        let dict = CGSessionCopyCurrentDictionary();
        if dict.is_null() {
            return false;
        }

        // Build a CFString for the key name.
        let key_cstr = b"CGSSessionScreenIsLocked\0";
        let key_cf = CFStringCreateWithCString(
            std::ptr::null_mut(),
            key_cstr.as_ptr() as *const i8,
            CF_STRING_ENCODING_UTF8,
        );
        if key_cf.is_null() {
            CFRelease(dict);
            return false;
        }

        // Look up the value.  Returns NULL if the key is absent (screen
        // unlocked — the key is only present when the screen is locked).
        let value = CFDictionaryGetValue(dict, key_cf as CFTypeRef);

        let locked = if value.is_null() {
            false
        } else {
            CFBooleanGetValue(value)
        };

        CFRelease(key_cf as CFTypeRef);
        CFRelease(dict);
        locked
    }
}

// ---------------------------------------------------------------------------
// SQLite write helper
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
async fn write_system_state_event(
    pool: &SqlitePool,
    state: &str,
    metadata_json: &str,
    redaction_pattern_cache: &mut RedactionPatternCache,
) {
    // System lock/wake activity is an app/window capture category. Any missing
    // table, consent row, or pause state fails closed before a DB write.
    let allowed = sqlx::query_as::<_, (i64,)>(
        "SELECT COALESCE((SELECT accepted_at IS NOT NULL AND app_window = 1 FROM capture_consent WHERE id = 1) AND (SELECT is_paused = 0 FROM capture_state WHERE id = 1), 0)",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|(value,)| value != 0)
    .unwrap_or(false);
    if !allowed {
        return;
    }
    redaction_pattern_cache.refresh_if_stale(pool).await;
    let event_id = Uuid::new_v4().to_string();
    let event_timestamp_milliseconds = Utc::now().timestamp_millis();

    if let Err(database_error) = sqlx::query(
        "INSERT INTO events \
             (id, timestamp, type, raw_content, app_name, url, source, metadata) \
         VALUES (?, ?, 'system_state', ?, NULL, NULL, 'rust', ?)",
    )
    .bind(&event_id)
    .bind(event_timestamp_milliseconds)
    .bind(redaction_pattern_cache.sanitize_text(state))
    .bind(redaction_pattern_cache.sanitize_text(metadata_json))
    .execute(pool)
    .await
    {
        eprintln!(
            "System state monitor: failed to write '{state}' event to SQLite: {database_error}"
        );
    }
}
