import { useCallback, useEffect, useRef, useState } from "react";
import type { CheatKind } from "@/lib/cheat";

export type LockdownCheatEvent =
  | "contextmenu"
  | "copy"
  | "cut"
  | "paste"
  | "dragstart"
  | "keydown:f12"
  | "keydown:devtools"
  | "keydown:print"
  | "keydown:save"
  | "keydown:view-source"
  | "visibilitychange:hidden"
  | "window:blur";

export type LockdownOrientation =
  | "any"
  | "natural"
  | "landscape"
  | "portrait"
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary";

export interface UseLockdownOptions {
  /** Master switch. When false the hook is a complete no-op (no listeners). */
  locked: boolean;
  /** Called on every blocked action / focus loss while locked. */
  onCheat?: (event: LockdownCheatEvent, nativeEvent?: Event) => void;
  /** Try `document.documentElement.requestFullscreen()` when lock engages. @default true */
  requestFullscreen?: boolean;
  /** Best-effort `navigator.clipboard.writeText("")` + native `clear_clipboard` when lock engages. @default true */
  clearClipboard?: boolean;
  /** Optional mobile screen orientation lock (e.g. "any" | "landscape" | "portrait"). @default false */
  lockOrientation?: LockdownOrientation | false;
}

export interface UseLockdownResult {
  cheatCount: number;
  /** Re-request fullscreen and native lockdown (useful after user presses Esc or resumes app). No-op when unlocked. */
  relock: () => void;
}

/** Map a `LockdownCheatEvent` to the backend `CheatKind` telemetry category. */
export function mapCheatEventToKind(
  event: LockdownCheatEvent,
): CheatKind | null {
  switch (event) {
    case "visibilitychange:hidden":
      return "tab_switch";
    case "window:blur":
      return "blur";
    case "copy":
    case "cut":
    case "paste":
      return "paste";
    case "keydown:f12":
    case "keydown:devtools":
    case "keydown:print":
    case "keydown:save":
    case "keydown:view-source":
      return "shortcut";
    default:
      return null;
  }
}

function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

function tryRequestFullscreen(): void {
  try {
    if (typeof document === "undefined" || isFullscreen()) return;
    const el = document.documentElement;
    if (!el) return;
    const req =
      el.requestFullscreen?.bind(el) ??
      (el as unknown as Record<string, unknown>).webkitRequestFullscreen;
    if (typeof req === "function") {
      const out = (req as () => Promise<void> | void)();
      if (out && typeof (out as Promise<void>).catch === "function") {
        (out as Promise<void>).catch(() => {
          /* user gesture required or unsupported in mobile WebView — caller can retry via relock() */
        });
      }
    }
  } catch {
    /* never break the exam UI over fullscreen */
  }
}

function tryExitFullscreen(): void {
  try {
    if (typeof document === "undefined" || !isFullscreen()) return;
    const exit =
      document.exitFullscreen?.bind(document) ??
      (document as unknown as Record<string, unknown>).webkitExitFullscreen;
    if (typeof exit === "function") {
      const out = (exit as () => Promise<void> | void)();
      if (out && typeof (out as Promise<void>).catch === "function") {
        (out as Promise<void>).catch(() => undefined);
      }
    }
  } catch {
    /* ignore */
  }
}

function tryLockOrientation(orientation: LockdownOrientation): void {
  try {
    if (typeof screen === "undefined") return;
    const scr = screen as Screen & {
      orientation?: { lock?: (o: string) => Promise<void> };
    };
    const lockFn = scr.orientation?.lock;
    if (typeof lockFn === "function") {
      void lockFn.call(scr.orientation, orientation).catch(() => undefined);
    }
  } catch {
    /* orientation lock unsupported on desktop or non-fullscreen mobile — ignore */
  }
}

function tryUnlockOrientation(): void {
  try {
    if (typeof screen === "undefined") return;
    const scr = screen as Screen & {
      orientation?: { unlock?: () => void };
    };
    scr.orientation?.unlock?.();
  } catch {
    /* ignore */
  }
}

async function tryTauriInvoke(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<boolean> {
  try {
    const mod = await import("@tauri-apps/api/core").catch(() => null);
    const invoke = (mod as { invoke?: unknown } | null)?.invoke;
    if (typeof invoke !== "function") return false;
    await (
      invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>
    )(cmd, args);
    return true;
  } catch {
    return false;
  }
}

function tryClearClipboard(): void {
  try {
    if (typeof navigator !== "undefined") {
      const clip = navigator.clipboard;
      if (clip && typeof clip.writeText === "function") {
        void clip.writeText("").catch(() => undefined);
      }
    }
  } catch {
    /* clipboard API may be unavailable — ignore */
  }
  void tryTauriInvoke("clear_clipboard");
}

/**
 * Strong app-level lockdown for exams across desktop and mobile.
 *
 * While `locked === true`:
 *  - invokes Tauri `set_locked({ locked: true })` (kiosk/content-protection on desktop,
 *    `FLAG_SECURE` + `FLAG_KEEP_SCREEN_ON` on Android) with safe web/mobile fallback
 *  - requests fullscreen (once on engage + via `relock()`)
 *  - optionally locks mobile screen orientation (`screen.orientation.lock`)
 *  - blocks contextmenu / copy / cut / paste / dragstart (preventDefault + onCheat)
 *  - blocks F12, Ctrl/Cmd+Shift+I/J/C (devtools), Ctrl/Cmd+P (print),
 *    Ctrl/Cmd+S (save), Ctrl/Cmd+U (view-source)
 *  - reports `visibilitychange` (hidden) + window `blur` + Tauri `lockdown-focus-lost` via onCheat
 *  - clears clipboard once on lock
 *
 * While `locked === false`: no-op — no listeners attached, no side effects.
 */
export function useLockdown(options: UseLockdownOptions): UseLockdownResult {
  const {
    locked,
    onCheat,
    requestFullscreen = true,
    clearClipboard = true,
    lockOrientation = false,
  } = options;

  const [cheatCount, setCheatCount] = useState(0);
  const onCheatRef = useRef(onCheat);
  const lastBlurAtRef = useRef(0);

  useEffect(() => {
    onCheatRef.current = onCheat;
  }, [onCheat]);

  const report = useCallback((event: LockdownCheatEvent, e?: Event) => {
    setCheatCount((c) => c + 1);
    try {
      onCheatRef.current?.(event, e);
    } catch {
      /* host callback must never break lockdown */
    }
  }, []);

  const relock = useCallback(() => {
    if (!locked) return;
    void tryTauriInvoke("set_locked", { locked: true });
    if (requestFullscreen) tryRequestFullscreen();
    if (lockOrientation) tryLockOrientation(lockOrientation);
  }, [locked, requestFullscreen, lockOrientation]);

  useEffect(() => {
    if (!locked) return; // <-- no-op when unlocked

    void tryTauriInvoke("set_locked", { locked: true });
    if (requestFullscreen) tryRequestFullscreen();
    if (lockOrientation) tryLockOrientation(lockOrientation);
    if (clearClipboard) tryClearClipboard();

    const reportBlurDeduped = (e?: Event) => {
      const now = Date.now();
      if (now - lastBlurAtRef.current < 150) return;
      lastBlurAtRef.current = now;
      report("window:blur", e);
    };

    const onContextMenu = (e: Event) => {
      e.preventDefault();
      report("contextmenu", e);
    };
    const onCopy = (e: Event) => {
      e.preventDefault();
      report("copy", e);
    };
    const onCut = (e: Event) => {
      e.preventDefault();
      report("cut", e);
    };
    const onPaste = (e: Event) => {
      e.preventDefault();
      report("paste", e);
    };
    const onDragStart = (e: Event) => {
      e.preventDefault();
      report("dragstart", e);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const mod = e.ctrlKey || e.metaKey;

      if (key === "F12") {
        e.preventDefault();
        report("keydown:f12", e);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        const k = key.toUpperCase();
        if (k === "I" || k === "J" || k === "C") {
          e.preventDefault();
          report("keydown:devtools", e);
          return;
        }
      }
      if (mod) {
        const k = key.toUpperCase();
        if (k === "P") {
          e.preventDefault();
          report("keydown:print", e);
          return;
        }
        if (k === "S") {
          e.preventDefault();
          report("keydown:save", e);
          return;
        }
        if (k === "U") {
          e.preventDefault();
          report("keydown:view-source", e);
          return;
        }
      }
    };

    const onVisibility = (e: Event) => {
      if (document.visibilityState === "hidden") {
        report("visibilitychange:hidden", e);
      } else if (document.visibilityState === "visible") {
        // Re-assert fullscreen/orientation when returning to the app on mobile/desktop.
        if (requestFullscreen) tryRequestFullscreen();
        if (lockOrientation) tryLockOrientation(lockOrientation);
      }
    };
    const onBlur = (e: Event) => {
      reportBlurDeduped(e);
    };

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);

    let disposed = false;
    let unlistenTauriFocus: (() => void) | null = null;
    void (async () => {
      try {
        const eventMod = await import("@tauri-apps/api/event").catch(() => null);
        const listen = (eventMod as { listen?: unknown } | null)?.listen;
        if (typeof listen !== "function") return;
        const unlisten = await (
          listen as (
            event: string,
            handler: () => void,
          ) => Promise<() => void>
        )("lockdown-focus-lost", () => {
          if (!disposed) reportBlurDeduped();
        });
        if (disposed) {
          unlisten();
        } else {
          unlistenTauriFocus = unlisten;
        }
      } catch {
        /* ignore when outside Tauri runtime */
      }
    })();

    return () => {
      disposed = true;
      unlistenTauriFocus?.();
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      if (lockOrientation) tryUnlockOrientation();
      if (requestFullscreen) tryExitFullscreen();
      void tryTauriInvoke("set_locked", { locked: false });
    };
  }, [locked, requestFullscreen, clearClipboard, lockOrientation, report]);

  return { cheatCount, relock };
}

export default useLockdown;
