/**
 * Student session helpers for the Tauri frontend.
 *
 * - Access token lives in memory + AES-GCM encrypted localStorage (see api.ts
 *   + secure-storage.ts, enc:v2). Device id persists in localStorage plaintext
 *   for backend device binding (it is the PBKDF2 password input, not a secret
 *   on its own — the per-value random salt provides install binding).
 * - Role gate: this app shell is student-only.
 *
 * NOTE: framework-agnostic — no imports from src/lib/api*.
 */

export type SessionRole = "student" | "admin" | "teacher" | string;

export interface StudentSession {
  accessToken: string;
  role: SessionRole;
  studentId?: string;
  deviceId: string;
}

const DEVICE_KEY = "bestway_device_id";

// --- in-memory token store (module scope, cleared on reload) ---
let inMemoryToken: string | null = null;
let inMemoryRole: SessionRole | null = null;
let inMemoryStudentId: string | null = null;

function randomId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `dev-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** Stable per-device id, persisted in localStorage. Safe on SSR (returns "" outside browser). */
export function getDeviceId(): string {
  if (typeof window === "undefined" || !window.localStorage) return "";
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = randomId();
    try {
      window.localStorage.setItem(DEVICE_KEY, id);
    } catch {
      /* storage blocked — still return the generated id for this session */
    }
  }
  return id;
}

/** Alias that makes the ensure-semantics explicit at call sites. */
export function ensureDeviceId(): string {
  return getDeviceId();
}

export function setAccessToken(token: string | null): void {
  inMemoryToken = token && token.length > 0 ? token : null;
}

export function getAccessToken(): string | null {
  return inMemoryToken;
}

export function getRole(): SessionRole | null {
  return inMemoryRole;
}

export function getStudentId(): string | null {
  return inMemoryStudentId;
}

/** True only when a token is present AND role is exactly "student". */
export function isStudent(): boolean {
  return inMemoryToken !== null && inMemoryRole === "student";
}

/** True when any authenticated session exists (regardless of role). */
export function isAuthenticated(): boolean {
  return inMemoryToken !== null;
}

/**
 * Throws when the current session is not an authenticated student.
 * Use at the top of student-only screens/actions.
 */
export function assertStudent(): void {
  if (!inMemoryToken) throw new Error("Not authenticated");
  if (inMemoryRole !== "student") {
    throw new Error(`Access denied: student-only (role=${inMemoryRole})`);
  }
}

export interface SetSessionInput {
  accessToken: string;
  role: SessionRole;
  studentId?: string;
}

/** Establish a session (validates student-only role). Returns the stored session. */
export function setSession(input: SetSessionInput): StudentSession {
  if (!input.accessToken) throw new Error("setSession: accessToken required");
  inMemoryToken = input.accessToken;
  inMemoryRole = input.role;
  inMemoryStudentId = input.studentId ?? null;
  if (input.role !== "student") {
    // Store first so callers can inspect, then enforce the gate.
    throw new Error(`Access denied: student-only (role=${input.role})`);
  }
  return {
    accessToken: input.accessToken,
    role: input.role,
    studentId: input.studentId,
    deviceId: getDeviceId(),
  };
}

/** Snapshot of the current session, or null when unauthenticated. */
export function getSession(): StudentSession | null {
  if (!inMemoryToken || !inMemoryRole) return null;
  return {
    accessToken: inMemoryToken,
    role: inMemoryRole,
    studentId: inMemoryStudentId ?? undefined,
    deviceId: getDeviceId(),
  };
}

/** Clear in-memory auth state. Device id is intentionally preserved. */
export function clearSession(): void {
  inMemoryToken = null;
  inMemoryRole = null;
  inMemoryStudentId = null;
}

/** Auth header helper — returns {} when unauthenticated. */
export function authHeaders(): Record<string, string> {
  if (!inMemoryToken) return {};
  return { Authorization: `Bearer ${inMemoryToken}` };
}
