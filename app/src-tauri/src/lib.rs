use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

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

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
