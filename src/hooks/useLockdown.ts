import { useCallback, useEffect, useRef, useState } from "react";

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

export interface UseLockdownOptions {
  /** Master switch. When false the hook is a complete no-op (no listeners). */
  locked: boolean;
  /** Called on every blocked action / focus loss while locked. */
  onCheat?: (event: LockdownCheatEvent, nativeEvent?: Event) => void;
  /** Try `document.documentElement.requestFullscreen()` when lock engages. @default true */
  requestFullscreen?: boolean;
  /** Best-effort `navigator.clipboard.writeText("")` when lock engages. @default true */
  clearClipboard?: boolean;
}

export interface UseLockdownResult {
  cheatCount: number;
  /** Re-request fullscreen (useful after user presses Esc). No-op when unlocked. */
  relock: () => void;
}

function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement);
}

function tryRequestFullscreen(): void {
  try {
    if (isFullscreen()) return;
    const el = document.documentElement;
    const req =
      el.requestFullscreen?.bind(el) ??
      (el as unknown as Record<string, unknown>).webkitRequestFullscreen;
    if (typeof req === "function") {
      const out = (req as () => Promise<void> | void)();
      if (out && typeof (out as Promise<void>).catch === "function") {
        (out as Promise<void>).catch(() => {
          /* user gesture required — caller can retry via relock() */
        });
      }
    }
  } catch {
    /* never break the exam UI over fullscreen */
  }
}

function tryClearClipboard(): void {
  try {
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      void clip.writeText("").catch(() => undefined);
    }
  } catch {
    /* clipboard API may be unavailable — ignore */
  }
}

/**
 * Strong app-level lockdown for exams.
 *
 * While `locked === true`:
 *  - requests fullscreen (once on engage + via `relock()`)
 *  - blocks contextmenu / copy / cut / paste / dragstart (preventDefault + onCheat)
 *  - blocks F12, Ctrl/Cmd+Shift+I/J/C (devtools), Ctrl/Cmd+P (print),
 *    Ctrl/Cmd+S (save), Ctrl/Cmd+U (view-source)
 *  - reports `visibilitychange` (hidden) + window `blur` via onCheat
 *  - clears clipboard once on lock
 *
 * While `locked === false`: no-op — no listeners attached, no side effects.
 */
export function useLockdown(options: UseLockdownOptions): UseLockdownResult {
  const { locked, onCheat, requestFullscreen = true, clearClipboard = true } =
    options;

  const [cheatCount, setCheatCount] = useState(0);
  const onCheatRef = useRef(onCheat);

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
    if (requestFullscreen) tryRequestFullscreen();
  }, [locked, requestFullscreen]);

  useEffect(() => {
    if (!locked) return; // <-- no-op when unlocked

    if (requestFullscreen) tryRequestFullscreen();
    if (clearClipboard) tryClearClipboard();

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
      }
    };
    const onBlur = (e: Event) => {
      report("window:blur", e);
    };

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [locked, requestFullscreen, clearClipboard, report]);

  return { cheatCount, relock };
}

export default useLockdown;
