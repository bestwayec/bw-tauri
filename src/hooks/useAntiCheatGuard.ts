import { useCallback, useEffect, useRef, useState } from "react";
import { post } from "@/lib/api";

export interface UseAntiCheatGuardOptions {
  /** Master switch to engage anti-cheat protection. Defaults to true. */
  enabled?: boolean;
  /** Active attempt ID (for telemetry tracking). */
  attemptId?: string;
  /** 6-digit live room PIN (if student joined via teacher PIN room). */
  roomPin?: string;
  /** Currently active question index/number. */
  currentQuestion?: number;
  /** Currently active skill/section (e.g. 'reading', 'writing'). */
  currentSection?: string;
  /** Remaining test duration in seconds. */
  timeRemaining?: number;
  /** Maximum strikes before disqualification. Defaults to 3. */
  maxStrikes?: number;
  /** Callback fired when a cheat anomaly / strike occurs. */
  onViolation?: (strikesCount: number, reason: string) => void;
  /** Callback fired when test is terminated due to 3 strikes or proctor action. */
  onTerminated?: (reason: string) => void;
  /** Periodic heartbeat interval in milliseconds. Defaults to 6000 (6s). */
  heartbeatIntervalMs?: number;
}

export interface UseAntiCheatGuardResult {
  strikesCount: number;
  isWarningOpen: boolean;
  countdown: number;
  isTerminated: boolean;
  dismissWarning: () => void;
  triggerViolation: (reason?: string) => void;
  relockKiosk: () => Promise<void>;
  unlockKiosk: () => Promise<void>;
}

export function isBlockedKeyCombo(e: {
  key?: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): { isBlocked: boolean; isViolation: boolean } {
  const key = e.key || "";
  const code = e.code || "";
  const isAltTab = !!e.altKey && (key === "Tab" || code === "Tab");
  const isMetaWin = key === "Meta" || key === "OS" || !!e.metaKey;
  const isF11 = key === "F11";
  const isF12 = key === "F12";
  const isPrintScreen = key === "PrintScreen";
  const isDevtools =
    (!!e.ctrlKey || !!e.metaKey) &&
    !!e.shiftKey &&
    ["I", "J", "C"].includes(key.toUpperCase());
  const isBlockedCombo =
    (!!e.ctrlKey || !!e.metaKey) &&
    ["C", "V", "A", "U", "P", "S"].includes(key.toUpperCase());

  const isBlocked = isAltTab || isMetaWin || isF11 || isF12 || isPrintScreen || isDevtools || isBlockedCombo;
  const isViolation = isAltTab || isMetaWin || isF11 || isF12 || isPrintScreen || isDevtools;

  return { isBlocked, isViolation };
}

export function getAntiCheatSeverity(strikesCount: number, maxStrikes: number = 3): "low" | "medium" | "critical" {
  if (strikesCount >= maxStrikes) return "critical";
  if (strikesCount >= 2) return "medium";
  return "low";
}

export async function setKioskLock(locked: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window").catch(() => ({
      getCurrentWindow: null as any,
    }));
    if (typeof getCurrentWindow === "function") {
      const appWindow = getCurrentWindow();
      if (appWindow) {
        if (locked) {
          await appWindow.setFullscreen(true).catch(() => undefined);
          await appWindow.setResizable(false).catch(() => undefined);
          await appWindow.setAlwaysOnTop(true).catch(() => undefined);
        } else {
          await appWindow.setAlwaysOnTop(false).catch(() => undefined);
          await appWindow.setResizable(true).catch(() => undefined);
          await appWindow.setFullscreen(false).catch(() => undefined);
        }
      }
    }
  } catch {
    /* Safe fallback outside Tauri runtime */
  }

  if (typeof document !== "undefined") {
    try {
      if (locked && !document.fullscreenElement) {
        document.documentElement?.requestFullscreen?.().catch(() => undefined);
      } else if (!locked && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }
}

export function useAntiCheatGuard(options: UseAntiCheatGuardOptions = {}): UseAntiCheatGuardResult {
  const {
    enabled = true,
    attemptId,
    roomPin,
    currentQuestion = 1,
    currentSection = "reading",
    timeRemaining,
    maxStrikes = 3,
    onViolation,
    onTerminated,
    heartbeatIntervalMs = 6000,
  } = options;

  const [strikesCount, setStrikesCount] = useState(0);
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [isTerminated, setIsTerminated] = useState(false);

  const strikesRef = useRef(0);
  const isTerminatedRef = useRef(false);
  const lastViolationAtRef = useRef(0);
  const countdownTimerRef = useRef<any>(null);

  strikesRef.current = strikesCount;
  isTerminatedRef.current = isTerminated;

  const relockKiosk = useCallback(async () => {
    if (enabled && !isTerminatedRef.current) {
      await setKioskLock(true);
    }
  }, [enabled]);

  const unlockKiosk = useCallback(async () => {
    await setKioskLock(false);
  }, []);

  // Send telemetry payload to backend
  const sendTelemetry = useCallback(
    async (overrideStrikes?: number, isFocusedState?: boolean) => {
      const activeStrikes = overrideStrikes !== undefined ? overrideStrikes : strikesRef.current;
      const focused = isFocusedState !== undefined ? isFocusedState : !isWarningOpen;

      try {
        const res = await post<{
          success?: boolean;
          action?: "continue" | "disqualified" | "end_exam";
          status?: string;
          strikesCount?: number;
        }>("/v1/live-room/telemetry", {
          room_pin: roomPin,
          attempt_id: attemptId,
          current_question: currentQuestion,
          current_section: currentSection,
          time_remaining: timeRemaining,
          strikes_count: activeStrikes,
          is_focused: focused,
        });

        if (res?.action === "disqualified" || res?.status === "disqualified") {
          setIsTerminated(true);
          isTerminatedRef.current = true;
          await unlockKiosk();
          onTerminated?.("disqualified_by_proctor");
        } else if (res?.action === "end_exam" || res?.status === "completed") {
          setIsTerminated(true);
          isTerminatedRef.current = true;
          await unlockKiosk();
          onTerminated?.("room_ended_by_proctor");
        }
      } catch {
        /* Offline telemetry fallback */
      }
    },
    [roomPin, attemptId, currentQuestion, currentSection, timeRemaining, isWarningOpen, unlockKiosk, onTerminated]
  );

  // Trigger violation
  const triggerViolation = useCallback(
    (reason: string = "FOCUS_LOST_WINDOW_BLUR") => {
      if (!enabled || isTerminatedRef.current) return;

      const now = Date.now();
      if (now - lastViolationAtRef.current < 1500) return;
      lastViolationAtRef.current = now;

      const newStrikes = strikesRef.current + 1;
      strikesRef.current = newStrikes;
      setStrikesCount(newStrikes);
      setIsWarningOpen(true);
      setCountdown(10);

      onViolation?.(newStrikes, reason);
      void sendTelemetry(newStrikes, false);

      if (newStrikes >= maxStrikes) {
        setIsTerminated(true);
        isTerminatedRef.current = true;
        void unlockKiosk();
        onTerminated?.("auto_submit_due_to_violation");
      }
    },
    [enabled, maxStrikes, onViolation, onTerminated, sendTelemetry, unlockKiosk]
  );

  // Dismiss warning and return to exam
  const dismissWarning = useCallback(() => {
    setIsWarningOpen(false);
    void relockKiosk();
    void sendTelemetry(strikesRef.current, true);
  }, [relockKiosk, sendTelemetry]);

  // Countdown effect when warning is open
  useEffect(() => {
    if (!isWarningOpen || isTerminated) {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      return;
    }

    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [isWarningOpen, isTerminated]);

  // Engage Kiosk Lock on mount and unlock on unmount
  useEffect(() => {
    if (enabled && !isTerminated) {
      void relockKiosk();
    }
    return () => {
      void unlockKiosk();
    };
  }, [enabled, isTerminated, relockKiosk, unlockKiosk]);

  // Event Listeners: Context Menu, Keyboard Shortcuts, Copy/Paste, Blur, Visibility
  useEffect(() => {
    if (!enabled || isTerminated || typeof window === "undefined") return;

    // 1. Context Menu (Right Click) Block
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // 2. Copy, Cut, Paste, Drag, SelectStart Block
    const onClipboard = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // 3. Dangerous Keydown Interception
    const onKeyDown = (e: KeyboardEvent) => {
      const { isBlocked, isViolation } = isBlockedKeyCombo(e);
      if (isBlocked) {
        e.preventDefault();
        e.stopPropagation();

        if (isViolation) {
          triggerViolation("SECURITY_KEYBOARD_SHORTCUT");
        }
      }
    };

    // 4. Focus Loss / Window Blur & Visibility Change
    const onBlur = () => {
      triggerViolation("WINDOW_BLUR");
    };

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.hidden) {
        triggerViolation("TAB_SWITCH_HIDDEN");
      }
    };

    const onMouseLeave = (e: MouseEvent) => {
      if (!e.relatedTarget && e.clientY <= 0) {
        triggerViolation("MOUSE_LEAVE_WINDOW");
      }
    };

    window.addEventListener("contextmenu", onContextMenu, { capture: true });
    window.addEventListener("copy", onClipboard, { capture: true });
    window.addEventListener("cut", onClipboard, { capture: true });
    window.addEventListener("paste", onClipboard, { capture: true });
    window.addEventListener("selectstart", onClipboard, { capture: true });
    window.addEventListener("dragstart", onClipboard, { capture: true });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("blur", onBlur);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
      document.documentElement?.addEventListener("mouseleave", onMouseLeave);
    }

    return () => {
      window.removeEventListener("contextmenu", onContextMenu, { capture: true });
      window.removeEventListener("copy", onClipboard, { capture: true });
      window.removeEventListener("cut", onClipboard, { capture: true });
      window.removeEventListener("paste", onClipboard, { capture: true });
      window.removeEventListener("selectstart", onClipboard, { capture: true });
      window.removeEventListener("dragstart", onClipboard, { capture: true });
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("blur", onBlur);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        document.documentElement?.removeEventListener("mouseleave", onMouseLeave);
      }
    };
  }, [enabled, isTerminated, triggerViolation]);

  // Periodic Telemetry Heartbeat
  useEffect(() => {
    if (!enabled || isTerminated || !heartbeatIntervalMs) return;

    const interval = setInterval(() => {
      void sendTelemetry();
    }, heartbeatIntervalMs);

    return () => clearInterval(interval);
  }, [enabled, isTerminated, heartbeatIntervalMs, sendTelemetry]);

  return {
    strikesCount,
    isWarningOpen,
    countdown,
    isTerminated,
    dismissWarning,
    triggerViolation,
    relockKiosk,
    unlockKiosk,
  };
}
