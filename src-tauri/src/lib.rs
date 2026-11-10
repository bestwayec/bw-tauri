mod battery;
mod browser;
mod encryption;
mod lockdown;
mod logger;
mod offline_media;
mod session;
mod tray;
mod update_probe;
mod video_stream;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Shared exam-lock flag. When true, close/quit requests are vetoed.
pub struct LockState(pub AtomicBool);

#[tauri::command]
fn set_locked(
    app: tauri::AppHandle,
    locked: bool,
    state: tauri::State<'_, LockState>,
) -> Result<(), String> {
    #[cfg(desktop)]
    if locked {
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(monitors) = window.available_monitors() {
                if monitors.len() > 1 {
                    return Err(
                        "MULTI_MONITOR_BLOCKED: Faqat bitta monitordan foydalanishga ruxsat berilgan"
                            .to_string(),
                    );
                }
            }
        }
    }
    state.0.store(locked, Ordering::SeqCst);

    if let Some(window) = app.get_webview_window("main") {
        lockdown::set_kiosk(&window, locked)?;
        logger::log_line(
            "INFO",
            if locked {
                "exam lock engaged"
            } else {
                "exam lock released"
            },
        );
    } else {
        return Err("main window not found".to_string());
    }

    // Best-effort: wipe clipboard when entering lockdown.
    if locked {
        let _ = app.clipboard().write_text(String::new());
    }

    Ok(())
}

/// Check count of attached monitors.
#[tauri::command]
fn check_monitors(app: tauri::AppHandle) -> Result<usize, String> {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(desktop)]
        {
            let monitors = window.available_monitors().map_err(|e| e.to_string())?;
            Ok(monitors.len())
        }
        #[cfg(mobile)]
        {
            let count = window
                .available_monitors()
                .map(|m| m.len().max(1))
                .unwrap_or(1);
            Ok(count)
        }
    } else {
        Err("main window not found".to_string())
    }
}

#[tauri::command]
fn clear_clipboard(app: tauri::AppHandle) -> Result<(), String> {
    let clipboard = app.clipboard();
    // `clear()` is platform-dependent; follow with empty write for text slots.
    let _ = clipboard.clear();
    clipboard
        .write_text(String::new())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide the main window to the tray (keeps running in background).
#[tauri::command]
fn minimize_to_tray(
    app: tauri::AppHandle,
    state: tauri::State<'_, LockState>,
) -> Result<(), String> {
    if state.0.load(Ordering::SeqCst) {
        return Err("Cannot minimize while exam is locked".to_string());
    }
    tray::hide_main(&app);
    Ok(())
}

/// Restore the main window from the tray.
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    tray::show_main(&app);
    Ok(())
}

/// Quit from UI. Vetoed while an exam lock is active.
#[tauri::command]
fn quit_app(app: tauri::AppHandle, state: tauri::State<'_, LockState>) -> Result<(), String> {
    if state.0.load(Ordering::SeqCst) {
        tray::show_main(&app);
        return Err("Cannot quit while exam is locked".to_string());
    }
    app.exit(0);
    Ok(())
}

/// Download an encrypted offline video file to app data directory
#[tauri::command]
async fn download_offline_video(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let videos_dir = app_dir.join("offline_videos");
    std::fs::create_dir_all(&videos_dir).map_err(|e| e.to_string())?;

    let safe_name = offline_media::video_filename(&filename)?;
    let target_path = videos_dir.join(safe_name);

    // Never replace a previously usable video with a truncated download.
    let temporary = videos_dir.join(format!(
        "{}.{}.part",
        offline_media::video_filename(&filename)?,
        rand::random::<u64>()
    ));
    if let Err(error) = encryption::download_and_encrypt_video(&url, &temporary).await {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    std::fs::rename(&temporary, &target_path).map_err(|e| e.to_string())?;
    Ok(target_path.to_string_lossy().to_string())
}

/// Query local machine key fingerprint for security audits
#[tauri::command]
fn get_offline_device_fingerprint() -> Result<String, String> {
    Ok(encryption::get_machine_fingerprint())
}

fn setup_media_environment() {
    #[cfg(target_os = "windows")]
    {
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let media_flags = "--enable-media-stream --enable-features=msWebAudioCapture,msWebAudioCaptureMute,PreloadMediaEngagementData --autoplay-policy=no-user-gesture-required";
        if !existing.contains("--enable-media-stream") {
            let combined = if existing.is_empty() {
                media_flags.to_string()
            } else {
                format!("{} {}", existing, media_flags)
            };
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined);
        }
    }

    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_WEBRTC_AUDIO_CAPTURE", "1");
        std::env::set_var("WEBKIT_MEDIA_STREAM", "1");
    }
}

/// Second-instance argv entries that carry one of the app's deep-link schemes.
#[cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]
fn is_callback_arg(arg: &str) -> bool {
    let lower = arg.trim().to_ascii_lowercase();
    ["bestway-exam:", "bestway:", "bestwayapp:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_media_environment();

    let builder = tauri::Builder::default()
        .manage(LockState(AtomicBool::new(false)))
        .manage(session::SessionStore::new())
        .manage(battery::BatteryCache::new());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            #[cfg(desktop)]
            {
                let _ = window.unminimize();
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
        // OAuth callback arrives as second-instance argv on Win/Linux
        // (e.g. `bestway-app.exe bestway-exam://auth/callback?code=..`).
        // The single-instance `deep-link` feature already hands these URLs to
        // the deep-link plugin, which emits `deep-link://new-url` with the
        // `string[]` payload `onOpenUrl` expects. Emitting that event by hand
        // here sent a bare string and broke the listener, so only the
        // app-owned `single-instance` event (always an array) is sent.
        let urls: Vec<String> = args
            .into_iter()
            .filter(|a| is_callback_arg(a))
            .collect();
        if !urls.is_empty() {
            let _ = app.emit("single-instance", urls);
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder.register_uri_scheme_protocol("bway", |ctx, request| {
        let root = ctx
            .app_handle()
            .path()
            .app_data_dir()
            .map(|dir| dir.join("offline_videos"));
        match root {
            Ok(root) => video_stream::handle_bway_protocol(&request, &root),
            Err(_) => tauri::http::Response::builder()
                .status(403)
                .body(Vec::new())
                .unwrap(),
        }
    });

    builder
        .setup(|app| {
            // Tray must exist before any window hides on desktop, otherwise the app
            // would look like it vanished with no way back.
            #[cfg(desktop)]
            if let Err(e) = tray::build_tray(app.handle()) {
                eprintln!("[tray] failed to build tray icon: {e}");
            }

            // Enforce screenshot/screen-recording protection on startup
            // (native content protection on desktop + FLAG_SECURE on Android).
            if let Some(window) = app.get_webview_window("main") {
                lockdown::enable_content_protection(&window);
            }

            // Resolve the durable session dir, then reload disk state so a
            // refresh that landed just before a restart is never lost.
            match app.path().app_data_dir() {
                Ok(dir) => {
                    if let Err(e) = std::fs::create_dir_all(&dir) {
                        eprintln!("[session] app data dir unavailable: {e}");
                    }
                    logger::init(&dir);
                    logger::log_line("INFO", "app starting");
                    app.state::<session::SessionStore>().init_app_dir(dir);
                }
                Err(e) => eprintln!("[session] app data dir unavailable: {e}"),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // The window is gone: no kiosk state may survive it.
                lockdown::release_all();
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let locked = window
                    .app_handle()
                    .try_state::<LockState>()
                    .map(|s| s.0.load(Ordering::SeqCst))
                    .unwrap_or(false);
                #[cfg(desktop)]
                {
                    // Locked exam → stay visible. Unlocked → hide to tray and
                    // keep running in the background instead of exiting.
                    api.prevent_close();
                    if locked {
                        let _ = window.emit("exam:close-requested", ());
                        let _ = window.show();
                        let _ = window.set_focus();
                    } else if let Err(e) = window.hide() {
                        eprintln!("[tray] failed to hide window to tray: {e}");
                    }
                }
                #[cfg(mobile)]
                if locked {
                    api.prevent_close();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            if matches!(
                event,
                tauri::WindowEvent::Focused(false) | tauri::WindowEvent::Resized(_)
            ) {
                let locked = window
                    .app_handle()
                    .try_state::<LockState>()
                    .map(|s| s.0.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if locked {
                    if matches!(event, tauri::WindowEvent::Focused(false)) {
                        let _ = window.emit("lockdown-focus-lost", ());
                    }
                    #[cfg(desktop)]
                    {
                        if let Ok(true) = window.is_minimized() {
                            let _ = window.unminimize();
                        }
                        let _ = window.set_fullscreen(true);
                        let _ = window.set_always_on_top(true);
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            battery::get_battery,
            browser::open_system_browser,
            set_locked,
            check_monitors,
            clear_clipboard,
            minimize_to_tray,
            show_main_window,
            quit_app,
            session::session_get,
            session::session_set,
            session::session_update_profile,
            session::session_clear,
            session::auth_refresh,
            session::auth_logout,
            download_offline_video,
            get_offline_device_fingerprint,
            update_probe::probe_download_url
        ])
        .build(tauri::generate_context!())
        .expect("error while building Bestway Exam")
        .run(|app, event| {
            // Any process exit path releases OS lockdown primitives first.
            // (Borrow only — the ExitRequested branch below moves `event`.)
            if matches!(&event, tauri::RunEvent::Exit) {
                lockdown::release_all();
            }
            // Cmd+Q / Alt+F4 / tray-quit arrive here as ExitRequested.
            // Veto while locked so the exam cannot be bypassed.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let locked = app
                    .try_state::<LockState>()
                    .map(|s| s.0.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if locked {
                    api.prevent_exit();
                    tray::show_main(app);
                } else {
                    lockdown::release_all();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::is_callback_arg;

    #[test]
    fn forwards_only_app_scheme_arguments() {
        assert!(is_callback_arg("bestway-exam://auth/callback?code=1&state=s"));
        assert!(is_callback_arg("bestway://auth/callback?code=1"));
        assert!(is_callback_arg("BestwayApp://auth?code=1"));
        assert!(!is_callback_arg(r"C:\Program Files\Bestway App\bestway-app.exe"));
        assert!(!is_callback_arg("--flag"));
        assert!(!is_callback_arg("https://bestwayec.uz"));
    }
}
