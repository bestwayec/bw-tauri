import { post } from "./api";

export interface HeartbeatOptions {
  attemptId: string;
  /** Called on every tick; when true the student client is in locked exam mode. */
  getLocked: () => boolean;
  /** Defaults to 15000ms. */
  intervalMs?: number;
  scope?: "tests" | "mock";
  onOffline?: () => void;
  onError?: (err: unknown) => void;
}

export interface HeartbeatPayload {
  attemptId: string;
  locked: boolean;
  scope?: "tests" | "mock";
  at: string;
}

/**
 * Start a periodic POST /exam-desktop/heartbeat loop.
 * Returns a `stop()` function — call it on unmount / exam finish.
 *
 * Offline behaviour (online-only v1): the tick is skipped and an
 * `exam:offline` window event is dispatched so the UI can show a banner.
 * Nothing is persisted/retried — v1 requires connectivity.
 */
export function startHeartbeat(options: HeartbeatOptions): () => void {
  const { attemptId, getLocked, intervalMs = 15000, scope, onOffline, onError } = options;

  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function teardown(): void {
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", handleOffline);
    }
  }

  function isTerminal(err: unknown): boolean {
    const status =
      typeof err === "object" && err !== null
        ? (err as { status?: unknown }).status
        : undefined;
    // Backend route missing (404) or unauthorized (401/403): retrying every
    // 15s only spams logs — stop the loop and surface once via onError.
    return status === 404 || status === 401 || status === 403;
  }

  async function beat(): Promise<void> {
    if (stopped || inFlight) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      notifyOffline(onOffline);
      return;
    }
    inFlight = true;
    const payload: HeartbeatPayload = {
      attemptId,
      locked: safeGetLocked(getLocked),
      ...(scope ? { scope } : {}),
      at: new Date().toISOString(),
    };
    try {
      await post<void>("/exam-desktop/heartbeat", payload);
    } catch (err) {
      onError?.(err);
      if (isTerminal(err)) teardown();
    } finally {
      inFlight = false;
    }
  }

  // Fire once immediately so presence shows up without waiting a full interval.
  void beat();
  timer = setInterval(() => {
    void beat();
  }, intervalMs);

  // If the browser fires online/offline events, surface them for the banner.
  const handleOffline = (): void => notifyOffline(onOffline);
  if (typeof window !== "undefined") {
    window.addEventListener("offline", handleOffline);
  }

  return function stop(): void {
    teardown();
  };
}

function safeGetLocked(getLocked: () => boolean): boolean {
  try {
    return getLocked();
  } catch {
    return false;
  }
}

function notifyOffline(onOffline?: () => void): void {
  try {
    onOffline?.();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("exam:offline"));
    }
  } catch {
    // Never let banner signalling break the exam loop.
  }
}
