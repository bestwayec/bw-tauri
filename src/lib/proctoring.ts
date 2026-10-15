import { reportCheat, type CheatKind, type CheatScope } from "./cheat";
import { offlineDelete, offlineGet, offlinePut } from "./offline-store";

/**
 * Proctoring: durable security log, webcam integrity snapshots and the
 * focus/window-loss audit trail.
 *
 * Storage: the trail lives in the shared offline store
 * (`src/lib/offline-store.ts`) — IndexedDB where the webview has it,
 * localStorage otherwise — under the `security` namespace, one JSON array per
 * attempt, so it survives a reload or a crash next to the rest of the offline
 * exam data. A mirrored in-memory copy keeps the trail working when no storage
 * exists at all (node tests, private mode, devtools disabled). Every write is
 * best-effort: a proctoring log must never break an exam.
 */

export type SecurityEventKind =
  | "camera_ready"
  | "webcam_denied"
  | "webcam_blocked"
  | "webcam_snapshot"
  | "focus_lost"
  | "window_blur"
  | "window_minimised";

export interface SecurityLogEntry {
  id: string;
  attemptId: string;
  kind: SecurityEventKind;
  /** ISO timestamp of the event. */
  at: string;
  detail?: string;
  /** Snapshot size in bytes (webcam_snapshot only). */
  bytes?: number;
}

const SECURITY_NAMESPACE = "security";
/** Bound the local trail so a long exam cannot exhaust the origin's quota. */
const MAX_ENTRIES = 200;

const memory = new Map<string, SecurityLogEntry[]>();

function newId(): string {
  try {
    const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    /* fall through to the deterministic-enough fallback */
  }
  return `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isEntry(value: unknown): value is SecurityLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<SecurityLogEntry>;
  return typeof e.id === "string" && typeof e.attemptId === "string" &&
    typeof e.kind === "string" && typeof e.at === "string";
}

function parseEntries(raw: unknown): SecurityLogEntry[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(isEntry);
  } catch {
    /* corrupt payload — recover from memory instead of throwing */
  }
  return null;
}

async function readEntries(attemptId: string): Promise<SecurityLogEntry[]> {
  const stored = parseEntries(await offlineGet(SECURITY_NAMESPACE, attemptId));
  if (stored) {
    memory.set(attemptId, stored);
    return stored;
  }
  return memory.get(attemptId) ?? [];
}

async function writeEntries(attemptId: string, entries: SecurityLogEntry[]): Promise<void> {
  const bounded = entries.slice(-MAX_ENTRIES);
  memory.set(attemptId, bounded);
  await offlinePut(SECURITY_NAMESPACE, attemptId, JSON.stringify(bounded));
}

/** Append one security event. Returns the stored entry (with id + attemptId). */
export async function appendSecurityLog(
  attemptId: string,
  entry: Omit<SecurityLogEntry, "id" | "attemptId">,
): Promise<SecurityLogEntry> {
  const full: SecurityLogEntry = { id: newId(), attemptId, ...entry };
  await writeEntries(attemptId, [...(await readEntries(attemptId)), full]);
  return full;
}

/** Every logged security event for the attempt, oldest first. */
export async function readSecurityLog(attemptId: string): Promise<SecurityLogEntry[]> {
  return readEntries(attemptId);
}

/** Drop the attempt's local trail (called once the attempt is finished). */
export async function clearSecurityLog(attemptId: string): Promise<void> {
  memory.delete(attemptId);
  await offlineDelete(SECURITY_NAMESPACE, attemptId).catch(() => false);
}

/** Whether this build can open a camera at all (permission is separate). */
export function proctorSupported(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof document !== "undefined"
    );
  } catch {
    return false;
  }
}

/** Default budget for a camera frame (permission prompt excluded). */
export const CAMERA_TIMEOUT_MS = 8000;

/** Human copy for a getUserMedia/DOMException failure. */
export function cameraFailureMessage(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Camera permission was blocked. Ask an invigilator, or continue without the camera check.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. You can continue without the camera check.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is busy in another application. Close it and try again, or continue without the camera check.";
    default:
      return "The camera check failed. You can continue without it — the exam still records focus and window changes.";
  }
}

function releaseStream(stream: MediaStream | null): void {
  if (!stream || typeof stream.getTracks !== "function") return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* an already-stopped track must not throw during cleanup */
    }
  }
}

function estimateBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
  return Math.max(0, Math.round((base64.length * 3) / 4));
}

/** Wait until the video element has a drawable frame. */
function waitForFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      video.addEventListener?.("loadedmetadata", finish, { once: true });
      const played = video.play?.();
      if (played && typeof played.catch === "function") void played.catch(() => undefined);
    } catch {
      /* a webview without addEventListener still gets the polling fallback */
    }
    const started = Date.now();
    const tick = () => {
      if (done) return;
      if (video.videoWidth > 0 || Date.now() - started >= timeoutMs) return finish();
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });
}

/**
 * Capture one webcam frame as a JPEG data URL.
 *
 * The camera is opened for this single frame and every track is stopped again
 * before returning (also on failure/timeout), so no stream is ever left
 * running in the background.
 *
 * Throws a friendly `Error` (see `cameraFailureMessage`) when the camera is
 * unavailable, denied or too slow — callers offer a skip path.
 */
export async function captureWebcamSnapshot(
  opts: { timeoutMs?: number } = {},
): Promise<{ dataUrl: string; bytes: number }> {
  if (!proctorSupported()) {
    throw new Error("The camera check is unavailable on this device. You can continue without it.");
  }
  const timeoutMs =
    typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : CAMERA_TIMEOUT_MS;

  let stream: MediaStream | null = null;
  const pending = navigator.mediaDevices.getUserMedia({ video: { width: 640 }, audio: false });
  try {
    stream = await withTimeout(
      pending,
      timeoutMs,
      "The camera did not respond in time. You can continue without the camera check.",
    );
  } catch (error) {
    // A camera that answers AFTER the timeout must still be released, otherwise
    // the camera light stays on for the rest of the exam.
    void pending.then(releaseStream).catch(() => undefined);
    releaseStream(stream);
    // Our own timeout already carries friendly copy; a DOMException is mapped
    // by name so the student never sees "NotAllowedError" and friends.
    if (isOwnTimeout(error)) throw error as Error;
    throw new Error(cameraFailureMessage(error));
  }

  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await waitForFrame(video, timeoutMs);
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The camera frame could not be captured. You can continue without the camera check.");
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) {
      throw new Error("The camera frame could not be captured. You can continue without the camera check.");
    }
    return { dataUrl, bytes: estimateBytes(dataUrl) };
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("The camera frame could not be captured. You can continue without the camera check.");
  } finally {
    releaseStream(stream);
  }
}

/** Marker so a self-made timeout keeps its friendly copy in the catch above. */
interface OwnTimeout extends Error {
  proctorTimeout?: boolean;
}

function isOwnTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as OwnTimeout).proctorTimeout === true;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const timeout: OwnTimeout = new Error(message);
      timeout.proctorTimeout = true;
      reject(timeout);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Short human line stored in the security log next to a snapshot. */
export function snapshotDetail(bytes: number): string {
  return `Webcam snapshot (~${formatBytes(bytes)})`;
}

function formatBytes(bytes: number): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value)} B`;
}

/** Random integrity snapshots happen every 10-15 minutes. */
export const PROCTOR_SNAPSHOT_MIN_MS = 600_000;
export const PROCTOR_SNAPSHOT_MAX_MS = 900_000;

/** Uniform delay in [MIN, MAX]; `random` is injectable for deterministic tests. */
export function nextSnapshotDelay(random: () => number = Math.random): number {
  const raw = random();
  const unit = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  return Math.round(PROCTOR_SNAPSHOT_MIN_MS + unit * (PROCTOR_SNAPSHOT_MAX_MS - PROCTOR_SNAPSHOT_MIN_MS));
}

/** Map a `useLockdown` event onto the local audit kind. */
export function eventKindFromLockdown(event: string): SecurityEventKind {
  if (event === "visibilitychange:hidden") return "window_minimised";
  if (event === "window:blur") return "window_blur";
  return "focus_lost";
}

/**
 * Focus/window-loss audit: persist the event locally and forward it to the
 * invigilator's live monitoring panel through the existing `flag-cheat`
 * channel. Both halves are best-effort — losing the log must never interrupt
 * the exam, and losing the network must never lose the local record.
 */
export async function logLockdownEvent(
  attemptId: string,
  event: string,
  report: (attemptId: string, kind: CheatKind, scope: CheatScope) => Promise<void> = reportCheat,
  scope: CheatScope = "mock",
): Promise<SecurityLogEntry> {
  const kind = eventKindFromLockdown(event);
  const entry = await appendSecurityLog(attemptId, {
    kind,
    at: new Date().toISOString(),
    detail: `Lockdown event: ${event}`,
  });
  const cheat = cheatKindFor(kind);
  if (cheat) {
    try {
      await report(attemptId, cheat, scope);
    } catch {
      /* the local entry above is the durable record */
    }
  }
  return entry;
}

/**
 * The backend `flag-cheat` channel accepts only
 * `tab_switch | blur | paste | shortcut`. Proctoring events map onto these —
 * `null` means the event stays local (the teacher panel has no slot for it)
 * and must never be sent with an invented value.
 */
export function cheatKindFor(kind: SecurityEventKind): CheatKind | null {
  switch (kind) {
    case "window_minimised":
      return "tab_switch";
    case "focus_lost":
    case "window_blur":
    case "webcam_snapshot":
      return "blur";
    default:
      return null;
  }
}
