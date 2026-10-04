#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod battery;
mod browser;
mod lockdown;
mod logger;
mod session;
mod tray;

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
fn minimize_to_tray(app: tauri::AppHandle) -> Result<(), String> {
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

fn main() {
    tauri::Builder::default()
        .manage(LockState(AtomicBool::new(false)))
        .manage(session::SessionStore::new())
        .manage(battery::BatteryCache::new())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            // OAuth callback arrives as second-instance argv on Win/Linux
            // (e.g. `bestway-app.exe bestway-exam://auth/callback?code=..`).
            // Forward it so the frontend `onOpenUrl` + `single-instance`
            // listeners can complete the exchange.
            let urls: Vec<String> = args
                .into_iter()
                .filter(|a| a.starts_with("bestway-exam:"))
                .collect();
            if !urls.is_empty() {
                for url in urls.clone() {
                    // Triggers JS `onOpenUrl` when deep-link plugin listens.
                    let _ = app.emit("deep-link://new-url", url);
                }
                let _ = app.emit("single-instance", urls);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Tray must exist before any window hides, otherwise the app
            // would look like it vanished with no way back.
            if let Err(e) = tray::build_tray(app.handle()) {
                eprintln!("[tray] failed to build tray icon: {e}");
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
                // Locked exam → stay visible. Unlocked → hide to tray and
                // keep running in the background instead of exiting.
                api.prevent_close();
                if locked {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else if let Err(e) = window.hide() {
                    eprintln!("[tray] failed to hide window to tray: {e}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            battery::get_battery,
            browser::open_system_browser,
            set_locked,
            clear_clipboard,
            minimize_to_tray,
            show_main_window,
            quit_app,
            session::session_get,
            session::session_set,
            session::session_clear,
            session::auth_refresh,
            session::auth_logout
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
