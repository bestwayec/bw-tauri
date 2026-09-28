#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod battery;
mod lockdown;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Shared exam-lock flag. When true, close requests are vetoed.
struct LockState(AtomicBool);

#[tauri::command]
fn get_battery() -> battery::BatteryInfo {
    battery::get_battery()
}

#[tauri::command]
fn set_locked(
    app: tauri::AppHandle,
    locked: bool,
    state: tauri::State<'_, LockState>,
) -> Result<(), String> {
    state.0.store(locked, Ordering::SeqCst);

    if let Some(window) = app.get_webview_window("main") {
        lockdown::set_kiosk(&window, locked)?;
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

fn main() {
    tauri::Builder::default()
        .manage(LockState(AtomicBool::new(false)))
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.app_handle().try_state::<LockState>() {
                    if state.0.load(Ordering::SeqCst) {
                        api.prevent_close();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_battery,
            set_locked,
            clear_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bestway Exam");
}
