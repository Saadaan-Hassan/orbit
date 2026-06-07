use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Returns true if the app has been granted Accessibility permission.
///
/// Runs a quick osascript probe — if it succeeds, the OS has granted access.
/// If it fails with an error 1743 / "not allowed assistive access" the
/// permission has not been granted yet.
#[tauri::command]
fn check_accessibility_permission_granted() -> bool {
    std::process::Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get name of processes"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
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

/// Writes ~/.orbit/onboarding_done to mark onboarding as complete.
#[tauri::command]
fn mark_onboarding_completed() {
    let home = std::env::var("HOME").unwrap_or_default();
    let orbit_dir = format!("{}/.orbit", home);
    let _ = std::fs::create_dir_all(&orbit_dir);
    let _ = std::fs::write(format!("{}/onboarding_done", orbit_dir), "1");
}

/// Entry point used by main.rs when no exit hook is needed (mobile / tests).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    run_with_exit_hook(|| {});
}

/// Entry point that calls `on_exit_hook` just before the process terminates.
/// main.rs uses this to kill the FastAPI child process on quit.
pub fn run_with_exit_hook<ExitHook>(on_exit_hook: ExitHook)
where
    ExitHook: FnOnce() + Send + 'static,
{
    // Wrap the hook in Option so it can be consumed exactly once inside the
    // move closure that Tauri requires for on_window_event.
    let exit_hook_cell = std::sync::Mutex::new(Some(on_exit_hook));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Auto-updater: checks the endpoint in tauri.conf.json on startup.
        // tauri-plugin-dialog drives the "update available" prompt natively.
        // tauri-plugin-process provides relaunch() after the update installs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Removes dock icon and Cmd+Tab entry on macOS.
            // Info.plist handles bundled builds; this covers dev mode.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Register global shortcut
            let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["alt+space"])?
                .with_handler(|app_handle, shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if shortcut.matches(tauri_plugin_global_shortcut::Modifiers::ALT, tauri_plugin_global_shortcut::Code::Space) {
                            if let Some(main_window) = app_handle.get_webview_window("main") {
                                let is_visible = main_window.is_visible().unwrap_or(false);
                                if is_visible {
                                    let _ = main_window.hide();
                                } else {
                                    position_window_on_active_monitor(&main_window, PositionMode::Expanded);
                                    let _ = main_window.show();
                                    let _ = main_window.set_focus();
                                    let _ = app_handle.emit("navigate", "chat");
                                }
                            }
                        }
                    }
                })
                .build();
            app.handle().plugin(shortcut_plugin)?;

            let orbit_item = MenuItem::with_id(
                app,
                "orbit",
                "Orbit",
                true,
                None::<&str>,
            )?;

            let memory_item = MenuItem::with_id(
                app,
                "memory",
                "Memory",
                true,
                None::<&str>,
            )?;

            let privacy_item = MenuItem::with_id(
                app,
                "privacy",
                "Privacy",
                true,
                None::<&str>,
            )?;

            let quit_item = MenuItem::with_id(
                app,
                "quit",
                "Quit",
                true,
                None::<&str>,
            )?;

            let tray_menu = Menu::with_items(
                app,
                &[&orbit_item, &memory_item, &privacy_item, &quit_item],
            )?;

            // Load the dedicated tray icon at compile time so the correct
            // Orbit icon always appears in the menu bar, regardless of what
            // Tauri infers as the "default window icon" from the bundle.
            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/trayicon.png"),
            )
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
                    } = event {
                        let app_handle = tray.app_handle();
                        if let Some(main_window) = app_handle.get_webview_window("main") {
                            let is_visible = main_window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = main_window.hide();
                            } else {
                                position_window_on_active_monitor(&main_window, PositionMode::Expanded);
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

                            if let Some(main_window) =
                                app_handle.get_webview_window("main")
                            {
                                position_window_on_active_monitor(&main_window, PositionMode::Expanded);
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                            }

                            // Tell React which panel to render. The "navigate"
                            // event is listened to in App.tsx via @tauri-apps/api/event.
                            let _ = app_handle.emit("navigate", panel_name);
                        }
                        "quit" => {
                            // Run the exit hook (kills FastAPI) before telling
                            // Tauri to terminate the process.
                            if let Ok(mut guard) = exit_hook_cell.lock() {
                                if let Some(hook) = guard.take() {
                                    hook();
                                }
                            }
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_accessibility_permission_granted,
            open_accessibility_system_settings,
            get_onboarding_completed,
            mark_onboarding_completed,
            position_window,
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
        PositionMode::Expanded | PositionMode::Center => (500.0, 650.0),
    };
    let size = tauri::PhysicalSize::new((logical_w * scale_factor) as u32, (logical_h * scale_factor) as u32);
    
    let cursor_pos = match window.cursor_position() {
        Ok(pos) => pos,
        Err(_) => {
            // Fallback: just use current monitor
            if let Ok(Some(monitor)) = window.current_monitor() {
                let x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
                let y = match mode {
                    PositionMode::Collapsed => monitor.position().y + (30.0 * scale_factor) as i32,
                    PositionMode::Expanded => monitor.position().y + (80.0 * scale_factor) as i32,
                    PositionMode::Center => monitor.position().y + (monitor.size().height as i32 - size.height as i32) / 2,
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

            if x >= pos.x && x < pos.x + monitor_size.width as i32 && y >= pos.y && y < pos.y + monitor_size.height as i32 {
                let target_x = pos.x + (monitor_size.width as i32 - size.width as i32) / 2;
                let target_y = match mode {
                    PositionMode::Collapsed => pos.y + (30.0 * scale_factor) as i32,
                    PositionMode::Expanded => pos.y + (80.0 * scale_factor) as i32,
                    PositionMode::Center => pos.y + (monitor_size.height as i32 - size.height as i32) / 2,
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
            PositionMode::Center => monitor.position().y + (monitor.size().height as i32 - size.height as i32) / 2,
        };
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}
