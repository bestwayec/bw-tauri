/// Kiosk / lockdown helpers.
///
/// Shared entry point is [`set_kiosk`], which always toggles fullscreen +
/// always-on-top + focus (safe fallback on every platform), then applies
/// best-effort OS-specific hardening behind `#[cfg(target_os = ...)]`.
///
/// Per-platform matrix (what IS / IS NOT blocked while locked):
/// - Windows: blocks Win keys, Alt+Tab, Alt+F4, Ctrl+Shift+Esc via a
///   `WH_KEYBOARD_LL` low-level hook. `Ctrl+Alt+Del` (Secure Attention
///   Sequence) is handled by Winlogon and CANNOT be blocked from userspace.
///   Task-Manager kill by an admin, power button, and USB boot are also out
///   of scope — true kiosk needs Assigned Access / Group Policy (Phase 2).
/// - macOS: suppresses Dock, menu bar, and Cmd+Tab process switching via
///   `NSApplication` presentationOptions while locked; restores defaults on
///   unlock. Force-quit gestures / Siri / power are not fully blockable.
/// - Linux: best-effort `XGrabKeyboard` on X11 only. Wayland compositors
///   generally ignore client-side grabs, so lockdown there is
///   compositor-dependent (needs Cage / Weston kiosk-shell policy).
pub fn set_kiosk(window: &tauri::WebviewWindow, locked: bool) -> Result<(), String> {
    window.set_fullscreen(locked).map_err(|e| e.to_string())?;
    window
        .set_always_on_top(locked)
        .map_err(|e| e.to_string())?;

    if locked {
        // Best-effort: keep focus while locked; ignore errors (window may be closing).
        let _ = window.set_focus();
    }

    #[cfg(target_os = "windows")]
    apply_windows_lockdown(locked);

    #[cfg(target_os = "macos")]
    apply_macos_lockdown(locked);

    #[cfg(target_os = "linux")]
    apply_linux_lockdown(locked);

    Ok(())
}

// ---------------------------------------------------------------------------
// Windows: WH_KEYBOARD_LL low-level hook
// ---------------------------------------------------------------------------
/// Windows hardening.
///
/// Installs a `WH_KEYBOARD_LL` hook while `locked` that swallows Win keys,
/// Alt+Tab, Alt+F4, and Ctrl+Shift+Esc. Hook install failure never errors
/// `set_kiosk` — the caller keeps the fullscreen + always-on-top fallback.
///
/// NOTE (best-effort only): `Ctrl+Alt+Del` (Secure Attention Sequence) is
/// handled by Winlogon at a higher privilege level and **cannot** be blocked
/// from userspace. Full lockdown requires Group Policy / Assigned Access /
/// kiosk mode, not just this hook. The hook also dies with the process
/// (admin Task-Manager kill still works).
#[cfg(target_os = "windows")]
mod windows_hook {
    use std::sync::{
        atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering},
        Mutex,
    };
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN,
        MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    static HOOK: AtomicIsize = AtomicIsize::new(0);
    static LOCKED: AtomicBool = AtomicBool::new(false);
    static THREAD_ID: AtomicU32 = AtomicU32::new(0);
    static THREAD_HANDLE: Mutex<Option<std::thread::JoinHandle<()>>> = Mutex::new(None);

    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;
    const VK_TAB: u32 = 0x09;
    const VK_F4: u32 = 0x73;
    const VK_ESCAPE: u32 = 0x1B;

    unsafe extern "system" fn ll_hook(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if ncode == HC_ACTION as i32 && LOCKED.load(Ordering::SeqCst) {
            let msg = wparam.0 as u32;
            if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN || msg == WM_KEYUP || msg == WM_SYSKEYUP {
                let info = *(lparam.0 as *const KBDLLHOOKSTRUCT);
                let vk = info.vkCode;
                let alt_down = (info.flags.0 & LLKHF_ALTDOWN.0) != 0;
                let swallow = vk == VK_LWIN
                    || vk == VK_RWIN
                    || (vk == VK_TAB && alt_down)
                    || (vk == VK_F4 && alt_down)
                    || (vk == VK_ESCAPE && alt_down);
                if swallow {
                    return LRESULT(1);
                }
            }
        }
        unsafe { CallNextHookEx(None, ncode, wparam, lparam) }
    }

    fn unhook_raw() {
        let raw = HOOK.swap(0, Ordering::SeqCst);
        if raw != 0 {
            unsafe {
                let _ = UnhookWindowsHookEx(HHOOK(raw as *mut std::ffi::c_void));
            }
        }
    }

    /// Install the hook on its OWN thread with its own message loop, so the
    /// kiosk never depends on (or blocks) the Tauri main loop.
    pub(super) fn install() {
        LOCKED.store(true, Ordering::SeqCst);
        if THREAD_HANDLE.lock().map(|g| g.is_some()).unwrap_or(false) {
            return; // already installed
        }
        let handle = std::thread::spawn(|| unsafe {
            let module = GetModuleHandleW(None).unwrap_or_default();
            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_hook), Some(module.into()), 0) {
                Ok(h) => HOOK.store(h.0 as isize, Ordering::SeqCst),
                Err(e) => {
                    eprintln!("[lockdown] Windows keyboard hook install failed: {e} (fallback: fullscreen+top)");
                    return;
                }
            }
            THREAD_ID.store(current_thread_id(), Ordering::SeqCst);
            let mut msg = MSG::default();
            // Pump until WM_QUIT (posted by `uninstall`). The return value is
            // intentionally ignored: exit path always unhooks below.
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            // Belt and suspenders: the thread that installed the hook removes it.
            unhook_raw();
        });
        if let Ok(mut g) = THREAD_HANDLE.lock() {
            *g = Some(handle);
        }
    }

    /// Stop the pump thread, join it, and guarantee the hook is gone.
    /// Safe to call when nothing is installed.
    pub(super) fn uninstall() {
        LOCKED.store(false, Ordering::SeqCst);
        let tid = THREAD_ID.swap(0, Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                // Wake GetMessageW so it observes WM_QUIT and exits.
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
        let handle = THREAD_HANDLE.lock().ok().and_then(|mut g| g.take());
        if let Some(h) = handle {
            let _ = h.join();
        }
        // Join or not, the handle must be gone (covers install failure races).
        unhook_raw();
    }

    // GetCurrentThreadId lives in the kernel32 export table; declared
    // directly to avoid pulling a new `windows` feature module.
    unsafe extern "system" {
        fn GetCurrentThreadId() -> u32;
    }

    fn current_thread_id() -> u32 {
        unsafe { GetCurrentThreadId() }
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_lockdown(locked: bool) {
    if locked {
        windows_hook::install();
    } else {
        windows_hook::uninstall();
    }
}

/// Release every OS-level lockdown primitive. Called on unlock, window
/// destroy, and process exit so a crash can never leave a PC keyboard-locked
/// (the OS also drops hooks of dead processes — this covers graceful paths).
pub fn release_all() {
    #[cfg(target_os = "windows")]
    windows_hook::uninstall();
}

// ---------------------------------------------------------------------------
// macOS: NSApplication presentationOptions
// ---------------------------------------------------------------------------
/// macOS hardening.
///
/// Sets `NSApplication` presentation options to hide the Dock + menu bar and
/// disable process switching / force-quit / session termination while locked,
/// restoring defaults on unlock. Must run on the main thread; when the main
/// thread marker is unavailable we keep the fullscreen + always-on-top
/// fallback and log instead of failing.
#[cfg(target_os = "macos")]
fn apply_macos_lockdown(locked: bool) {
    use objc2_app_kit::{NSApplication, NSApplicationPresentationOptions};
    use objc2_foundation::MainThreadMarker;

    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[lockdown] macOS: not on main thread, keeping fullscreen fallback");
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    if locked {
        let opts = NSApplicationPresentationOptions::HideDock
            | NSApplicationPresentationOptions::HideMenuBar
            | NSApplicationPresentationOptions::DisableProcessSwitching
            | NSApplicationPresentationOptions::DisableForceQuit
            | NSApplicationPresentationOptions::DisableSessionTermination
            | NSApplicationPresentationOptions::AutoHideToolbar
            | NSApplicationPresentationOptions::FullScreen;
        app.setPresentationOptions(opts);
    } else {
        app.setPresentationOptions(NSApplicationPresentationOptions::empty());
    }
}

// ---------------------------------------------------------------------------
// Linux: X11 keyboard grab (best-effort) + Wayland gap documentation
// ---------------------------------------------------------------------------
/// Linux hardening.
///
/// Best-effort `XGrabKeyboard` on the X11 root window while locked (held by a
/// short-lived background thread that releases on unlock). Every X call is
/// fallible and degrades to the fullscreen + always-on-top fallback.
///
/// Wayland compositors generally ignore client-side grabs, so lockdown there
/// is compositor-dependent and NOT enforceable from this userspace client.
/// True kiosk on Wayland needs compositor-level policy (e.g. Cage,
/// Weston kiosk-shell, or Mutter kiosk mode) — out of scope here.
#[cfg(target_os = "linux")]
fn apply_linux_lockdown(locked: bool) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    static LINUX_LOCKED: AtomicBool = AtomicBool::new(false);
    static GRAB_THREAD_RUNNING: AtomicBool = AtomicBool::new(false);

    if locked {
        LINUX_LOCKED.store(true, Ordering::SeqCst);
        if GRAB_THREAD_RUNNING.swap(true, Ordering::SeqCst) {
            return; // grab thread already running
        }
        std::thread::spawn(|| {
            let (conn, screen) = match x11rb::connect(None) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!(
                        "[lockdown] Linux: X11 connect failed: {e} (fallback: fullscreen+top)"
                    );
                    GRAB_THREAD_RUNNING.store(false, Ordering::SeqCst);
                    return;
                }
            };
            use x11rb::connection::Connection;
            use x11rb::protocol::xproto::{ConnectionExt, GrabMode};
            let root = match conn.setup().roots.get(screen) {
                Some(s) => s.root,
                None => {
                    eprintln!("[lockdown] Linux: no X11 root window (fallback: fullscreen+top)");
                    GRAB_THREAD_RUNNING.store(false, Ordering::SeqCst);
                    return;
                }
            };
            // owner_events=false so all key events report to us while grabbed.
            // x11rb 0.13: GrabMode is a newtype struct (SYNC/ASYNC consts) and
            // Cookie::reply() returns Result<_, ReplyError>.
            let grabbed = match conn.grab_keyboard(
                false,
                root,
                x11rb::CURRENT_TIME,
                GrabMode::ASYNC,
                GrabMode::ASYNC,
            ) {
                Ok(cookie) => cookie
                    .reply()
                    .map(|reply| reply.status == x11rb::protocol::xproto::GrabStatus::SUCCESS)
                    .unwrap_or(false),
                Err(_) => false,
            };
            if !grabbed {
                eprintln!("[lockdown] Linux: XGrabKeyboard rejected by server (Wayland? fallback: fullscreen+top)");
            }
            let _ = conn.flush();
            // Hold the grab (connection open) while locked; poll cheaply.
            while LINUX_LOCKED.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(200));
            }
            let _ = conn.ungrab_keyboard(x11rb::CURRENT_TIME);
            let _ = conn.flush();
            GRAB_THREAD_RUNNING.store(false, Ordering::SeqCst);
        });
    } else {
        LINUX_LOCKED.store(false, Ordering::SeqCst);
    }
}
