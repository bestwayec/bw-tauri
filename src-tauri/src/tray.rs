//! System-tray + run-in-background helpers.
//!
//! Behaviour contract:
//! - Window `X` while **unlocked** → hide to tray, keep running in background.
//! - Window `X` while **locked** (exam) → vetoed, app stays visible.
//! - Tray left-click / double-click / "Show" → restore + focus main window.
//! - Tray "Quit" while **locked** → vetoed (restores window instead) so an
//!   exam cannot be bypassed from the tray. While unlocked → exits cleanly.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub const TRAY_ID: &str = "main-tray";
pub const MENU_SHOW_ID: &str = "tray-show";
pub const MENU_QUIT_ID: &str = "tray-quit";

/// Bring the main window back from tray / minimization.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Hide the main window but keep the process alive in the tray.
pub fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Build the tray icon + menu. Called once from `setup`.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW_ID, "Show Bestway Exam", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .or_else(|| {
            tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).ok()
        });

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Bestway Exam — running in background")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW_ID => show_main(app),
            MENU_QUIT_ID => {
                // Never let a locked exam be killed from the tray.
                let locked = app
                    .try_state::<super::LockState>()
                    .map(|s| {
                        s.0.load(std::sync::atomic::Ordering::SeqCst)
                    })
                    .unwrap_or(false);
                if locked {
                    show_main(app);
                } else {
                    app.exit(0);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Single left-click (Win/Linux) or double-click / Ctrl-click
            // (macOS) restores the window. `DoubleClick` has no button
            // payload, so match it separately.
            let restore = matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick { .. }
            );
            if restore {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
