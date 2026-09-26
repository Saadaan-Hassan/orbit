use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::SysRng, TryRng};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

fn secure_local_path(path: &std::path::Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if let Ok(metadata) = std::fs::symlink_metadata(path) {
            if !metadata.file_type().is_symlink() {
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
            }
        }
    }
}

/// Kept in Rust application state only. It is generated for each sidecar
/// lifecycle and never written to a file, Vite variable, URL, or analytics.
struct LocalApiSessionToken(String);

/// Result of the post-startup backend health check, readable via
/// `get_backend_status`. `None` means the check is still running.
///
/// The health check can succeed within milliseconds when the backend was
/// already warm (e.g. `uv`'s venv/cache already populated from a previous
/// run) — often faster than the webview can finish loading React and
/// registering its `backend-ready`/`backend-unavailable` listeners. A
/// `Tauri emit()` fired before any listener is registered is simply lost,
/// not queued, so a purely event-based design has a real race: the backend
/// becomes healthy, the event fires into the void, and the frontend is left
/// waiting for an event that already happened. Storing the result here lets
/// the frontend poll for the current state once it mounts, closing that gap
/// regardless of which happens first.
struct BackendReadyState(std::sync::Mutex<Option<bool>>);

pub fn generate_local_api_session_token() -> String {
    let mut token_bytes = [0_u8; 32];
    SysRng
        .try_fill_bytes(&mut token_bytes)
        .expect("OS random number source unavailable");
    URL_SAFE_NO_PAD.encode(token_bytes)
}

// ---------------------------------------------------------------------------
// Production sidecar state
//
// In release builds the backend runs as a bundled PyInstaller binary (sidecar)
// rather than a uv-spawned uvicorn process. The child handle is stored in Tauri
// app state so the quit handler can cleanly terminate it.
// ---------------------------------------------------------------------------

/// Wraps the sidecar child handle so it can be stored in Tauri app state and
/// killed cleanly when the user quits.
#[cfg(not(debug_assertions))]
struct SidecarHandle(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

/// Holds the exit hook (kills the dev-mode uv-spawned FastAPI process) as
/// managed Tauri state, boxed as a trait object since run_with_exit_hook is
/// generic per call but state needs one concrete type. Storing it in state
/// (rather than a closure-local variable reachable only from the tray's
/// on_menu_event handler) is what lets every exit path share one cleanup
/// path instead of only the tray's "Quit" item cleaning up.
struct ExitHookState(std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>>);

/// Kills the backend — the bundled PyInstaller sidecar in release builds,
/// the uv-spawned uvicorn process in dev — so nothing is left holding the
/// Qdrant file lock or port 47821. Call this before every exit/restart path,
/// not just the tray menu's "Quit" item.
fn kill_backend_process(app_handle: &tauri::AppHandle) {
    #[cfg(not(debug_assertions))]
    {
        if let Some(sidecar_state) = app_handle.try_state::<SidecarHandle>() {
            if let Ok(mut guard) = sidecar_state.0.lock() {
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
            }
        }
    }

    if let Some(exit_hook_state) = app_handle.try_state::<ExitHookState>() {
        if let Ok(mut guard) = exit_hook_state.0.lock() {
            if let Some(hook) = guard.take() {
                hook();
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: core_foundation::dictionary::CFDictionaryRef) -> u8;
}

/// Returns true if the app has been granted Accessibility permission.
///
/// Calls the native AXIsProcessTrusted() API directly. This previously ran
/// an osascript probe against System Events, but that only tests Automation
/// (Apple Events) permission for controlling System Events -- a separate TCC
/// grant this onboarding step never prompts for -- so it could report
/// "not granted" forever even after the user enabled Accessibility.
#[tauri::command]
fn check_accessibility_permission_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { AXIsProcessTrusted() != 0 }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Registers this process with macOS's TCC system and, if not yet decided,
/// shows the native "Orbit would like to control this computer" dialog.
///
/// `AXIsProcessTrusted()` is read-only: it never causes the app to appear in
/// System Settings > Privacy & Security > Accessibility at all if nothing
/// has ever registered it. Every capture monitor in this codebase checks
/// permission before attempting an AX call (to avoid doing anything without
/// consent), so without this explicit registration step nothing ever
/// triggers macOS to add Orbit to that list — the user is left staring at
/// an Accessibility pane with no way to grant a permission that was never
/// asked for. Call this once when the onboarding step is reached (or its
/// "Open System Settings" button is clicked), not on every poll — it can
/// surface a native system dialog, and this should only fire once until
/// the user has actually decided.
#[tauri::command]
fn trigger_accessibility_permission_prompt() {
    #[cfg(target_os = "macos")]
    {
        use core_foundation::base::TCFType;
        use core_foundation::boolean::CFBoolean;
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::CFString;

        let prompt_key = CFString::new("AXTrustedCheckOptionPrompt");
        let prompt_value = CFBoolean::from(true);
        let options = CFDictionary::from_CFType_pairs(&[(prompt_key, prompt_value)]);

        unsafe {
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef());
        }
    }
}

/// Opens System Settings directly to the Accessibility privacy pane.
#[tauri::command]
fn open_accessibility_system_settings() {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .ok();
}

/// Reads the onboarding-completed flag from ~/.orbit/onboarding_done.
#[tauri::command]
fn get_onboarding_completed() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    std::path::Path::new(&format!("{}/.orbit/onboarding_done", home)).exists()
}

/// Returns the current in-memory sidecar credential to Orbit's main webview.
/// The Tauri capability is restricted to the `main` window; the frontend keeps
/// the result only inside its shared API-client module.
#[tauri::command]
fn get_local_api_session_token(token: tauri::State<'_, LocalApiSessionToken>) -> String {
    token.0.clone()
}

/// Lets the frontend poll the backend health check's result on mount, instead
/// of relying solely on the `backend-ready`/`backend-unavailable` events —
/// see `BackendReadyState`'s doc comment for why the event alone can be
/// missed. Returns `None` while the check is still in progress.
#[tauri::command]
fn get_backend_status(state: tauri::State<'_, BackendReadyState>) -> Option<bool> {
    state.0.lock().ok().and_then(|guard| *guard)
}

/// Restarts the Tauri application using tauri-plugin-process.
///
/// Kills the backend first — without this, the old backend process would
/// keep running after restart() relaunches the app, and the new backend
/// spawn would fail to bind port 47821 / acquire the Qdrant file lock.
#[tauri::command]
fn restart_app(app_handle: tauri::AppHandle) {
    kill_backend_process(&app_handle);
    app_handle.restart();
}

/// Exits the application cleanly. Used by the startup-failure error screen.
#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    kill_backend_process(&app_handle);
    app_handle.exit(0);
}

/// Writes ~/.orbit/onboarding_done to mark onboarding as complete.
#[tauri::command]
fn mark_onboarding_completed() {
    let home = std::env::var("HOME").unwrap_or_default();
    let orbit_dir = format!("{}/.orbit", home);
    let orbit_dir_path = std::path::Path::new(&orbit_dir);
    let onboarding_path = orbit_dir_path.join("onboarding_done");
    let _ = std::fs::create_dir_all(orbit_dir_path);
    secure_local_path(orbit_dir_path, 0o700);
    let _ = std::fs::write(&onboarding_path, "1");
    secure_local_path(&onboarding_path, 0o600);
}

// ---------------------------------------------------------------------------
// Browser Automation permission commands
//
// macOS requires explicit Automation permission (System Settings → Privacy &
// Security → Automation) before any app can send Apple Events to a browser.
// These three commands let the frontend probe for that permission, trigger the
// macOS permission dialog during onboarding, and deep-link to the settings pane.
// ---------------------------------------------------------------------------

/// App names to probe when checking/triggering Automation permission.
/// Matches the KNOWN_BROWSER_APP_NAMES list in capture/unified_poller.rs.
const BROWSER_NAMES_FOR_AUTOMATION_PROBE: &[&str] = &[
    "Google Chrome",
    "Safari",
    "Arc",
    "Brave Browser",
    "Microsoft Edge",
];

/// Checks whether the Automation permission has been granted for at least one
/// known browser.
///
/// Probes each browser in turn with a minimal harmless AppleScript. Returns
/// false on the first -1743 (errAEEventNotPermitted) error — which means the
/// OS has denied Automation access. Returns true as soon as one probe succeeds.
/// Returns true when no known browser is running (can't test; permission will
/// surface naturally when the user first opens a browser).
#[tauri::command]
fn check_browser_automation_permission() -> bool {
    for browser_name in BROWSER_NAMES_FOR_AUTOMATION_PROBE {
        let script = format!("tell application \"{}\" to return name", browser_name);

        let output_result = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output();

        let output = match output_result {
            Ok(output) => output,
            Err(_) => continue,
        };

        let stderr_text = String::from_utf8_lossy(&output.stderr);
        let automation_was_denied = stderr_text.contains("Not authorized to send Apple events")
            || stderr_text.contains("-1743");

        if automation_was_denied {
            // At least one running browser has denied Automation access.
            return false;
        }

        if output.status.success() {
            // At least one browser responded — permission is granted.
            return true;
        }

        // Non-zero exit without -1743 means the browser is not running.
        // Try the next one.
    }

    // No known browser is running — we cannot probe. Return true so onboarding
    // does not block the user; the macOS dialog will appear naturally when a
    // browser is first opened and Orbit tries to read its active tab.
    true
}

/// Triggers the macOS Automation permission dialog(s) for all known browsers.
///
/// Runs a benign AppleScript (`return name`) against each browser. For any
/// browser that is currently running and has not yet been approved, macOS shows
/// "Allow Orbit to control <Browser>?" This is called during onboarding so the
/// user grants access up front rather than encountering the prompt mid-use.
/// Results are ignored — the only purpose is surfacing the permission dialogs.
#[tauri::command]
fn trigger_browser_automation_prompt() {
    for browser_name in BROWSER_NAMES_FOR_AUTOMATION_PROBE {
        let script = format!("tell application \"{}\" to return name", browser_name);
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output();
    }
}

/// Opens System Settings directly to the Automation privacy pane.
#[tauri::command]
fn open_automation_system_settings() {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
        .spawn()
        .ok();
}

/// Entry point used by main.rs when no exit hook is needed (mobile / tests).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    run_with_exit_hook(generate_local_api_session_token(), || {});
}

/// Entry point that calls `on_exit_hook` just before the process terminates.
/// main.rs uses this to kill the FastAPI child process on quit.
pub fn run_with_exit_hook<ExitHook>(local_api_session_token: String, on_exit_hook: ExitHook)
where
    ExitHook: FnOnce() + Send + 'static,
{
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Shell plugin — provides the sidecar() API used in production builds
        // to spawn the bundled orbit-backend binary.
        .plugin(tauri_plugin_shell::init())
        // tauri-plugin-dialog: native folder picker (PrivacyPanel's watched-
        // folders UI). tauri-plugin-process: restart_app()'s relaunch() —
        // used by ErrorBoundary's restart button, not update-related.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            // Managed state (not a closure-local variable) so quit_app and
            // restart_app can also run this cleanup — previously only the
            // tray menu's "Quit" item could reach it.
            app.manage(ExitHookState(std::sync::Mutex::new(Some(
                Box::new(on_exit_hook) as Box<dyn FnOnce() + Send>,
            ))));
            app.manage(LocalApiSessionToken(local_api_session_token.clone()));
            app.manage(BackendReadyState(std::sync::Mutex::new(None)));

            // Removes dock icon and Cmd+Tab entry on macOS.
            // Info.plist handles bundled builds; this covers dev mode.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Register global shortcut
            let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["alt+space"])?
                .with_handler(|app_handle, shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed
                        && shortcut.matches(
                            tauri_plugin_global_shortcut::Modifiers::ALT,
                            tauri_plugin_global_shortcut::Code::Space,
                        )
                    {
                        if let Some(main_window) = app_handle.get_webview_window("main") {
                            let is_visible = main_window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = main_window.hide();
                            } else {
                                position_window_on_active_monitor(
                                    &main_window,
                                    PositionMode::Expanded,
                                );
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                                let _ = app_handle.emit("navigate", "chat");
                            }
                        }
                    }
                })
                .build();
            app.handle().plugin(shortcut_plugin)?;

            let orbit_item = MenuItem::with_id(app, "orbit", "Orbit", true, None::<&str>)?;

            let memory_item = MenuItem::with_id(app, "memory", "Memory", true, None::<&str>)?;

            let privacy_item = MenuItem::with_id(app, "privacy", "Privacy", true, None::<&str>)?;

            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let tray_menu =
                Menu::with_items(app, &[&orbit_item, &memory_item, &privacy_item, &quit_item])?;

            // Load the dedicated tray icon at compile time so the correct
            // Orbit icon always appears in the menu bar, regardless of what
            // Tauri infers as the "default window icon" from the bundle.
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/trayicon.png"))
                    .expect("trayicon.png must be a valid PNG");

            TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(main_window) = app_handle.get_webview_window("main") {
                            let is_visible = main_window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = main_window.hide();
                            } else {
                                position_window_on_active_monitor(
                                    &main_window,
                                    PositionMode::Expanded,
                                );
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                                let _ = app_handle.emit("navigate", "chat");
                            }
                        }
                    }
                })
                .on_menu_event(move |app_handle, menu_event| {
                    match menu_event.id.as_ref() {
                        "orbit" | "memory" | "privacy" => {
                            // Map the menu item ID directly to the panel name the
                            // React router expects. "orbit" → "chat", the others
                            // match their menu ID verbatim.
                            let panel_name = if menu_event.id.as_ref() == "orbit" {
                                "chat"
                            } else {
                                menu_event.id.as_ref()
                            };

                            if let Some(main_window) = app_handle.get_webview_window("main") {
                                position_window_on_active_monitor(
                                    &main_window,
                                    PositionMode::Expanded,
                                );
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                            }

                            // Tell React which panel to render. The "navigate"
                            // event is listened to in App.tsx via @tauri-apps/api/event.
                            let _ = app_handle.emit("navigate", panel_name);
                        }
                        "quit" => {
                            kill_backend_process(app_handle);
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Position at top center of screen by default on startup (or center if onboarding not done)
            if let Some(main_window) = app.get_webview_window("main") {
                let onboarding_completed = {
                    let home = std::env::var("HOME").unwrap_or_default();
                    std::path::Path::new(&format!("{}/.orbit/onboarding_done", home)).exists()
                };
                let startup_mode = if onboarding_completed {
                    PositionMode::Collapsed
                } else {
                    PositionMode::Center
                };
                position_window_on_active_monitor(&main_window, startup_mode);
                let _ = main_window.show();
            }

            // ── Production sidecar ───────────────────────────────────────────
            // In release builds the backend runs as a bundled PyInstaller binary
            // instead of a uv-spawned uvicorn process. Spawn it here, store the
            // child handle in app state so the quit handler can kill it cleanly.
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_shell::ShellExt;
                let home = std::env::var("HOME").unwrap_or_default();
                let orbit_db_path = format!("{}/.orbit/orbit.db", home);
                let qdrant_path = format!("{}/.orbit/qdrant_storage", home);

                let (_rx, sidecar_child) = app
                    .shell()
                    .sidecar("orbit-backend")
                    .expect("orbit-backend sidecar not found in bundle")
                    .env("ORBIT_DB_PATH", &orbit_db_path)
                    .env("QDRANT_STORAGE_PATH", &qdrant_path)
                    .env("APP_ENVIRONMENT", "production")
                    .env("ORBIT_LOCAL_API_SESSION_TOKEN", &local_api_session_token)
                    .spawn()
                    .expect("Failed to spawn orbit-backend sidecar");

                app.manage(SidecarHandle(std::sync::Mutex::new(Some(sidecar_child))));
            }

            // Poll GET /health (1-second intervals) so the frontend knows when
            // the backend is actually ready. Budget is generous — a self-build
            // user's very first launch spawns `uv run uvicorn`, and if that
            // machine has never run this backend before, `uv` resolves and
            // installs the entire dependency set from scratch before uvicorn
            // even starts, which can easily take over a minute on a slow
            // connection. A short budget here has no way to recover once it
            // gives up: emitting "backend-unavailable" is a one-shot signal
            // the frontend cannot un-see, so if the backend comes up moments
            // after this loop quits, the UI is stuck on an error screen for a
            // backend that is, by then, perfectly healthy. `App.tsx`'s own
            // independent startup-error fallback timer must stay >= this
            // budget so it never fires first and pre-empts a check that's
            // still running.
            const HEALTH_CHECK_MAX_ATTEMPTS: u32 = 120;
            let health_check_app_handle = app.handle().clone();
            let health_check_token = local_api_session_token;
            tauri::async_runtime::spawn(async move {
                let http_client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(1))
                    .build()
                    .unwrap_or_default();

                let mut backend_is_up = false;
                for attempt in 0..HEALTH_CHECK_MAX_ATTEMPTS {
                    match http_client
                        .get("http://localhost:47821/health")
                        .bearer_auth(&health_check_token)
                        .send()
                        .await
                    {
                        Ok(response) => {
                            let status = response.status();
                            eprintln!("[health-check] attempt {attempt}: HTTP {status}");
                            if status.is_success() {
                                backend_is_up = true;
                                break;
                            }
                        }
                        Err(request_error) => {
                            eprintln!(
                                "[health-check] attempt {attempt}: request failed: {request_error}"
                            );
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }

                if let Some(ready_state) = health_check_app_handle.try_state::<BackendReadyState>()
                {
                    if let Ok(mut guard) = ready_state.0.lock() {
                        *guard = Some(backend_is_up);
                    }
                }

                if backend_is_up {
                    let _ = health_check_app_handle.emit("backend-ready", ());
                } else {
                    let _ = health_check_app_handle.emit("backend-unavailable", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_accessibility_permission_granted,
            trigger_accessibility_permission_prompt,
            open_accessibility_system_settings,
            get_onboarding_completed,
            get_local_api_session_token,
            get_backend_status,
            mark_onboarding_completed,
            restart_app,
            quit_app,
            position_window,
            check_browser_automation_permission,
            trigger_browser_automation_prompt,
            open_automation_system_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Debug, Clone, Copy)]
enum PositionMode {
    Collapsed,
    Expanded,
    Center,
}

#[tauri::command]
fn position_window(window: tauri::WebviewWindow, mode: String) {
    let mode = match mode.as_str() {
        "collapsed" => PositionMode::Collapsed,
        "expanded" => PositionMode::Expanded,
        "center" => PositionMode::Center,
        _ => PositionMode::Collapsed,
    };
    position_window_on_active_monitor(&window, mode);
}

fn position_window_on_active_monitor(window: &tauri::WebviewWindow, mode: PositionMode) {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let (logical_w, logical_h) = match mode {
        PositionMode::Collapsed => (230.0, 60.0),
        PositionMode::Expanded | PositionMode::Center => (720.0, 800.0),
    };
    let size = tauri::PhysicalSize::new(
        (logical_w * scale_factor) as u32,
        (logical_h * scale_factor) as u32,
    );

    let cursor_pos = match window.cursor_position() {
        Ok(pos) => pos,
        Err(_) => {
            // Fallback: just use current monitor
            if let Ok(Some(monitor)) = window.current_monitor() {
                let x =
                    monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
                let y = match mode {
                    PositionMode::Collapsed => monitor.position().y + (30.0 * scale_factor) as i32,
                    PositionMode::Expanded => monitor.position().y + (80.0 * scale_factor) as i32,
                    PositionMode::Center => {
                        monitor.position().y
                            + (monitor.size().height as i32 - size.height as i32) / 2
                    }
                };
                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
            }
            return;
        }
    };

    if let Ok(monitors) = window.available_monitors() {
        for monitor in monitors {
            let pos = monitor.position();
            let monitor_size = monitor.size();
            let x = cursor_pos.x as i32;
            let y = cursor_pos.y as i32;

            if x >= pos.x
                && x < pos.x + monitor_size.width as i32
                && y >= pos.y
                && y < pos.y + monitor_size.height as i32
            {
                let target_x = pos.x + (monitor_size.width as i32 - size.width as i32) / 2;
                let target_y = match mode {
                    PositionMode::Collapsed => pos.y + (30.0 * scale_factor) as i32,
                    PositionMode::Expanded => pos.y + (80.0 * scale_factor) as i32,
                    PositionMode::Center => {
                        pos.y + (monitor_size.height as i32 - size.height as i32) / 2
                    }
                };
                let _ = window.set_position(tauri::PhysicalPosition::new(target_x, target_y));
                return;
            }
        }
    }

    // Default fallback if no monitor matched:
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
        let y = match mode {
            PositionMode::Collapsed => monitor.position().y + (30.0 * scale_factor) as i32,
            PositionMode::Expanded => monitor.position().y + (80.0 * scale_factor) as i32,
            PositionMode::Center => {
                monitor.position().y + (monitor.size().height as i32 - size.height as i32) / 2
            }
        };
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

#[cfg(test)]
mod local_api_session_token_tests {
    use super::*;

    #[test]
    fn generates_distinct_256_bit_base64url_tokens() {
        let first = generate_local_api_session_token();
        let second = generate_local_api_session_token();

        assert_ne!(first, second);
        assert_eq!(URL_SAFE_NO_PAD.decode(first).unwrap().len(), 32);
        assert_eq!(URL_SAFE_NO_PAD.decode(second).unwrap().len(), 32);
    }
}
