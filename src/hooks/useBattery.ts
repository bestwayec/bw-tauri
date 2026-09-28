import { useCallback, useEffect, useRef, useState } from "react";

export interface BatterySnapshot {
  /** 0–100, or null when unknown */
  percent: number | null;
  charging: boolean;
  /** Raw backend state string when available (e.g. "Charging" / "Discharging") */
  state: string | null;
  unknown: boolean;
}

export interface UseBatteryResult extends BatterySnapshot {
  /** Re-run the full detection chain on demand. */
  refresh: () => Promise<void>;
}

/** Tauri `get_battery` command payload. */
interface TauriBatteryPayload {
  percent?: number;
  charging?: boolean;
  state?: string | null;
}

/** Minimal shape of the Browser Battery Status API (not in all TS libs). */
interface BrowserBatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BrowserBatteryManager>;
}

function clampPercent(v: unknown): number | null {
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  // Defensive ratio handling: only non-integer 0 < v < 1 is treated as 0..1 ratio.
  // Integer 0/1 are percents (0%/1%), not 0%/100% — avoids the 1.0 -> 1% vs 100% trap
  // by requiring a fractional value before scaling.
  if (v > 0 && v < 1 && !Number.isInteger(v)) {
    return Math.round(v * 100);
  }
  const n = Math.round(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

async function tryTauriBattery(): Promise<BatterySnapshot | null> {
  try {
    // Dynamic import => no hard dependency when running as plain web app.
    const mod = await import("@tauri-apps/api/core").catch(() => null);
    const invoke = (mod as { invoke?: unknown } | null)?.invoke;
    if (typeof invoke !== "function") return null;
    const raw = await (invoke as (cmd: string) => Promise<unknown>)(
      "get_battery",
    );
    if (!raw || typeof raw !== "object") return null;
    const payload = raw as TauriBatteryPayload;
    const percent = clampPercent(payload.percent);
    const charging =
      typeof payload.charging === "boolean"
        ? payload.charging
        : typeof payload.state === "string"
          ? payload.state.toLowerCase().includes("charg")
          : false;
    const stateText =
      typeof payload.state === "string" && payload.state.length > 0
        ? payload.state
        : charging
          ? "Charging"
          : "Discharging";
    if (percent === null) {
      // Preserve charging/state even when percent is unknown (desktop with
      // no battery) — mark unknown instead of discarding.
      return { percent: null, charging, state: stateText, unknown: true };
    }
    return {
      percent,
      charging,
      state:
        typeof payload.state === "string" && payload.state.length > 0
          ? payload.state
          : charging
            ? "Charging"
            : "Discharging",
      unknown: false,
    };
  } catch {
    return null;
  }
}

async function tryBrowserBattery(
  signal?: AbortSignal,
): Promise<BatterySnapshot | null> {
  try {
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== "function") return null;
    const mgr = await nav.getBattery();
    if (signal?.aborted) return null;
    // Browser API `level` is a 0..1 ratio — scale once, don't re-normalize.
    const percent = Math.min(100, Math.max(0, Math.round(mgr.level * 100)));
    return {
      percent,
      charging: mgr.charging === true,
      state: mgr.charging ? "Charging" : "Discharging",
      unknown: false,
    };
  } catch {
    return null;
  }
}

const UNKNOWN: BatterySnapshot = {
  percent: null,
  charging: false,
  state: null,
  unknown: true,
};

const POLL_MS = 30_000;

/**
 * Encapsulates battery detection with ordered fallbacks:
 *  1. Tauri `invoke('get_battery')` -> { percent, charging, state }
 *  2. Browser `navigator.getBattery()` fallback
 *  3. Unknown (`percent: null`, `unknown: true`)
 *
 * Polls every 30s and exposes `refresh()` for on-demand reads.
 * Safe on web (no hard `@tauri-apps/api` dependency — dynamic import only).
 */
export function useBattery(pollMs: number = POLL_MS): UseBatteryResult {
  const [snapshot, setSnapshot] = useState<BatterySnapshot>(UNKNOWN);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const apply = (snap: BatterySnapshot) => {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setSnapshot(snap);
      }
    };
    const fromTauri = await tryTauriBattery();
    if (fromTauri && !fromTauri.unknown) {
      apply(fromTauri);
      return;
    }
    const fromBrowser = await tryBrowserBattery(controller.signal);
    if (fromBrowser) {
      apply(fromBrowser);
      return;
    }
    // Preserve Tauri charging/state detail when both sources lack percent.
    apply(fromTauri ?? UNKNOWN);
  }, []);

  useEffect(() => {
    void refresh();
    if (pollMs <= 0) return;
    const id = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  return { ...snapshot, refresh };
}

export default useBattery;
