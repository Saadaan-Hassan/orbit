use chrono::Utc;
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Subscribes to macOS system state notifications (screen lock / unlock /
/// sleep / wake) and writes a `system_state` event row to SQLite for each
/// transition.
///
/// macOS-only: on other platforms this function returns immediately without
/// doing anything. macOS implementation uses Darwin's `notify.h` C API
/// (`notify_register_file_descriptor`) — no Objective-C or new crates needed.
pub async fn start_system_state_monitor(sqlx_connection_pool: SqlitePool) {
    #[cfg(target_os = "macos")]
    run_macos_system_state_monitor(sqlx_connection_pool).await;

    #[cfg(not(target_os = "macos"))]
    let _ = sqlx_connection_pool;
}

// ---------------------------------------------------------------------------
// macOS implementation
// ---------------------------------------------------------------------------

/// Four Darwin notification names and the state string each maps to.
#[cfg(target_os = "macos")]
const NOTIFICATIONS: &[(&str, &str)] = &[
    // Null-terminated so the pointer can be passed directly to the C API.
    ("com.apple.screenIsLocked\0", "lock"),
    ("com.apple.screenIsUnlocked\0", "unlock"),
    // willsleep fires before the system suspends; we try but may not always
    // receive it in time since the process can be suspended immediately after.
    ("com.apple.system.willsleep\0", "sleep"),
    // didwake fires reliably after the system resumes from sleep.
    ("com.apple.system.didwake\0", "wake"),
];

#[cfg(target_os = "macos")]
async fn run_macos_system_state_monitor(pool: SqlitePool) {
    // Darwin low-level notification C API (notify.h in libSystem, always linked
    // on macOS — no #[link] attribute or new crate required).
    //
    // notify_register_file_descriptor() creates a pipe internally and returns
    // the read end. The kernel writes 4 bytes (the notification token) every
    // time the named Darwin notification fires. A blocking read() on this fd
    // is the idiomatic way to wait for the next notification.
    extern "C" {
        fn notify_register_file_descriptor(
            name: *const std::ffi::c_char,
            fd: *mut i32,
            flags: i32,
            out_token: *mut i32,
        ) -> i32;

        fn read(fd: i32, buf: *mut std::ffi::c_void, count: usize) -> isize;

        // macOS errno accessor (replaces the POSIX errno macro which is not a
        // simple global on macOS — it's a function returning a thread-local ptr).
        fn __error() -> *mut i32;
    }

    // POSIX EINTR constant on macOS/Darwin.
    const EINTR: i32 = 4;

    let (state_event_sender, mut state_event_receiver) =
        mpsc::unbounded_channel::<&'static str>();

    for &(notification_name, state_string) in NOTIFICATIONS {
        let mut notify_fd: i32 = -1;
        let mut notify_token: i32 = 0;

        let register_result = unsafe {
            notify_register_file_descriptor(
                notification_name.as_ptr() as *const std::ffi::c_char,
                &mut notify_fd,
                0,
                &mut notify_token,
            )
        };

        if register_result != 0 || notify_fd < 0 {
            eprintln!(
                "System state monitor: failed to register Darwin notification '{}' \
                 (result={register_result})",
                notification_name.trim_end_matches('\0')
            );
            continue;
        }

        // A dedicated blocking OS thread per fd — not a tokio task — because
        // a synchronous blocking read() on these pipe-based fds is required.
        // State changes arrive infrequently (lock/sleep/wake) so the thread cost
        // is negligible.
        let sender_for_thread = state_event_sender.clone();
        std::thread::spawn(move || {
            let mut token_buffer = [0u8; 4];
            loop {
                let bytes_read = unsafe {
                    read(
                        notify_fd,
                        token_buffer.as_mut_ptr() as *mut std::ffi::c_void,
                        4,
                    )
                };

                if bytes_read < 0 {
                    let errno_value = unsafe { *__error() };
                    if errno_value == EINTR {
                        // Signal interrupted the read — retry.
                        continue;
                    }
                    eprintln!(
                        "System state monitor: read error on notify fd for '{}' \
                         (errno={errno_value})",
                        notification_name.trim_end_matches('\0')
                    );
                    break;
                }

                if bytes_read == 0 {
                    // EOF — fd closed, stop this listener.
                    break;
                }

                // Ignore send errors: they only occur when the receiver has been
                // dropped, which means the monitor task is shutting down.
                let _ = sender_for_thread.send(state_string);
            }
        });
    }

    // Drop the original sender so the channel closes when all listener threads
    // exit (i.e. when every cloned sender is dropped).
    drop(state_event_sender);

    // Async receive loop — write a SQLite event for each state transition.
    while let Some(state_string) = state_event_receiver.recv().await {
        let event_id = Uuid::new_v4().to_string();
        let event_timestamp_milliseconds = Utc::now().timestamp_millis();
        // state_string is always a short ASCII literal — inline JSON is safe.
        let metadata_json = format!(r#"{{"state":"{}"}}"#, state_string);

        if let Err(database_error) = sqlx::query(
            "INSERT INTO events \
                 (id, timestamp, type, raw_content, app_name, url, source, metadata) \
             VALUES (?, ?, 'system_state', ?, NULL, NULL, 'rust', ?)",
        )
        .bind(&event_id)
        .bind(event_timestamp_milliseconds)
        .bind(state_string)
        .bind(&metadata_json)
        .execute(&pool)
        .await
        {
            eprintln!(
                "System state monitor: failed to write '{state_string}' event \
                 to SQLite: {database_error}"
            );
        }
    }
}
