import { create } from "zustand";
import { API_BASE_URL } from "./config";
import {
  secureGetItemAsync,
  secureRemoveItemAsync,
  secureSetItemAsync,
} from "./secure-storage";
import { ensureDeviceId } from "./session";
import {
  isTauriRuntime,
  rustAuthLogout,
  rustAuthRefresh,
  rustSessionClear,
  rustSessionGet,
  rustSessionSet,
} from "./tauri-session";

/**
 * The ONE session owner (zustand). Replaces the old split between
 * session.ts (memory role/id) and api.ts (memory + encrypted tokens).
 *
 * - Inside Tauri, tokens live in Rust (OS keyring + atomic file fallback);
 *   JS keeps only the access token in memory for request headers.
 * - In a plain browser (`vite dev`) it falls back to the AES-GCM
 *   encrypted localStorage session + direct refresh POST.
 * - Refresh is single-flight on both sides; the session is wiped ONLY on
 *   definitive backend verdicts, never on network errors.
 */

export interface StoredProfile {
  id: string;
  name?: string | null;
  phone?: string | null;
  role?: string;
}

export type SessionStatus = "booting" | "ready" | "logged-out";

/** Backend verdicts that definitively end a session. Everything else is transient. */
export const DEFINITIVE_LOGOUT_CODES: ReadonlySet<string> = new Set([
  "INVALID_REFRESH_TOKEN",
  "SESSION_EXPIRED",
  "USER_DEACTIVATED",
]);

export function isDefinitiveLogout(code: string | undefined): boolean {
  return typeof code === "string" && DEFINITIVE_LOGOUT_CODES.has(code);
}

/**
 * Extract a backend verdict code from anything a refresh can throw.
 * Rust commands reject with the bare code string ("SESSION_EXPIRED") or a
 * prefixed message ("HTTP_TIMEOUT: ..."); API errors carry `{code}`.
 */
export function verdictOf(e: unknown): string | undefined {
  if (typeof e === "string") {
    const head = e.split(":")[0].trim();
    return /^[A-Z][A-Z0-9_]{2,}$/.test(head) ? head : undefined;
  }
  if (typeof e === "object" && e !== null) {
    const code = (e as ApiErrorLike).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Offline retry delay: exponential backoff capped at 60s (caller adds jitter). */
export function backoffMs(attempt: number): number {
  const capped = Math.min(Math.max(0, attempt), 10);
  return Math.min(1_000 * 2 ** capped, 60_000);
}

/** Milliseconds-since-epoch `exp` from a JWT, or null when unreadable. */
export function jwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: unknown;
    };
    return typeof json.exp === "number" && Number.isFinite(json.exp) ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

const ACCESS_KEY = "bestway.accessToken";
const REFRESH_KEY = "bestway.refreshToken";
/** Refresh this far ahead of expiry so requests almost never see a 401. */
const PROACTIVE_LEAD_MS = 75_000;

export interface ApiErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

function toError(code: string, message: string, status = 0): ApiErrorLike & { status: number } {
  const err = { code, message, status } as ApiErrorLike & { status: number };
  return err;
}

interface SessionState {
  status: SessionStatus;
  /** Last known connectivity (drives offline UI, never logs out). */
  online: boolean;
  accessToken: string | null;
  deviceId: string;
  profile: StoredProfile | null;
  initialize: () => Promise<void>;
  setSession: (input: {
    accessToken: string;
    refreshToken?: string | null;
    deviceId?: string;
    profile?: StoredProfile | null;
  }) => Promise<void>;
  /** Local wipe (logout already revoked server-side, or verdict definitive). */
  wipeLocal: () => Promise<void>;
  /** Server logout (revoke) + local wipe. The only normal way to end a session. */
  logout: () => Promise<void>;
  /** Single-flight refresh. Resolves the fresh access token. */
  refreshNow: () => Promise<string>;
  /** Background revalidation that never logs out on network failure. */
  revalidate: () => Promise<void>;
}

// Module-scope single-flight + timers (not reactive state).
let inflightRefresh: Promise<string> | null = null;
let proactiveTimer: number | null = null;
let onlineHooked = false;

function clearProactive() {
  if (proactiveTimer !== null) {
    window.clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}

function scheduleProactive(accessToken: string | null) {
  clearProactive();
  if (!accessToken || typeof window === "undefined") return;
  const exp = jwtExpMs(accessToken);
  // No readable exp (opaque token): fall back to a 10-minute safety refresh.
  const delay = exp == null ? 10 * 60_000 : Math.max(0, exp - Date.now() - PROACTIVE_LEAD_MS);
  proactiveTimer = window.setTimeout(
    () => {
      proactiveTimer = null;
      // Fire and forget: transient failures keep the old token; the 401
      // path and the next timer will retry. Definitive verdicts wipe.
      void useSessionStore
        .getState()
        .refreshNow()
        .catch(() => undefined);
    },
    Math.min(delay, 2_147_483_647),
  );
}

async function rawPost<T>(path: string, body: unknown, token: string | null, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const payload = (text ? JSON.parse(text) : null) as {
      success?: boolean;
      data?: T;
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      throw toError(
        payload?.error?.code ?? `HTTP_${res.status}`,
        payload?.error?.message ?? `Request failed: ${res.status}`,
        res.status,
      );
    }
    return (payload && typeof payload === "object" && "data" in payload
      ? (payload.data as T)
      : (payload as T)) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw toError("HTTP_TIMEOUT", "Request timed out", 408);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function rawGetMe(token: string): Promise<StoredProfile> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const text = await res.text();
    const payload = (text ? JSON.parse(text) : null) as {
      data?: { user?: StoredProfile };
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      throw toError(
        payload?.error?.code ?? `HTTP_${res.status}`,
        payload?.error?.message ?? `Request failed: ${res.status}`,
        res.status,
      );
    }
    const user = payload?.data?.user;
    if (!user?.id) throw toError("SCHEMA_MISMATCH", "me() returned no user", res.status);
    return user;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw toError("HTTP_TIMEOUT", "Request timed out", 408);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseProfile(json: string | null): StoredProfile | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as StoredProfile;
    return p && typeof p.id === "string" ? p : null;
  } catch {
    return null;
  }
}

export const useSessionStore = create<SessionState>()((set, get) => {
  async function persist(accessToken: string | null, refreshToken: string | null | undefined, profile: StoredProfile | null) {
    const { deviceId } = get();
    if (isTauriRuntime()) {
      await rustSessionSet({
        access_token: accessToken,
        refresh_token: refreshToken ?? (await rustSessionGet())?.refresh_token ?? null,
        device_id: deviceId,
        profile_json: profile ? JSON.stringify(profile) : null,
      });
    } else if (accessToken === null) {
      await secureRemoveItemAsync(ACCESS_KEY);
      await secureRemoveItemAsync(REFRESH_KEY);
    } else {
      await secureSetItemAsync(ACCESS_KEY, accessToken);
      if (refreshToken !== undefined) {
        if (refreshToken === null) await secureRemoveItemAsync(REFRESH_KEY);
        else await secureSetItemAsync(REFRESH_KEY, refreshToken);
      }
    }
  }

  return {
    status: "booting",
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    accessToken: null,
    deviceId: ensureDeviceId(),
    profile: null,

    initialize: async () => {
      const deviceId = ensureDeviceId();
      set({ deviceId, status: "booting" });

      if (!onlineHooked && typeof window !== "undefined") {
        onlineHooked = true;
        const poke = () => {
          const online = navigator.onLine;
          set({ online });
          // On resume from sleep/offline, refresh BEFORE queued requests retry
          // so they ride a fresh token instead of stampeding a 401.
          if (online && get().accessToken && get().status === "ready") {
            void get()
              .refreshNow()
              .catch(() => undefined);
          }
        };
        window.addEventListener("online", poke);
        window.addEventListener("offline", poke);
      }

      let access: string | null = null;
      let profile: StoredProfile | null = null;

      if (isTauriRuntime()) {
        try {
          const stored = await rustSessionGet();
          access = stored?.access_token ?? null;
          if (stored?.device_id) set({ deviceId: stored.device_id });
          profile = parseProfile(stored?.profile_json ?? null);
        } catch {
          access = null;
        }
        // One-way migration from the old encrypted-localStorage session.
        if (!access) {
          try {
            const [a, r] = await Promise.all([secureGetItemAsync(ACCESS_KEY), secureGetItemAsync(REFRESH_KEY)]);
            if (a) {
              await rustSessionSet({ access_token: a, refresh_token: r, device_id: get().deviceId, profile_json: null });
              await secureRemoveItemAsync(ACCESS_KEY);
              await secureRemoveItemAsync(REFRESH_KEY);
              access = a;
            }
          } catch {
            /* storage failure is non-fatal */
          }
        }
      } else {
        try {
          access = await secureGetItemAsync(ACCESS_KEY);
        } catch {
          access = null;
        }
      }

      if (!access) {
        set({ accessToken: null, profile: null, status: "logged-out" });
        return;
      }
      // Render the cached profile IMMEDIATELY; revalidate in the background.
      set({ accessToken: access, profile, status: "ready", online: typeof navigator === "undefined" ? true : navigator.onLine });
      scheduleProactive(access);
      void get().revalidate();
    },

    setSession: async (input) => {
      const deviceId = input.deviceId ?? get().deviceId;
      set({
        accessToken: input.accessToken,
        deviceId,
        profile: input.profile ?? get().profile,
        status: "ready",
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      });
      await persist(input.accessToken, input.refreshToken, get().profile).catch(() => undefined);
      scheduleProactive(input.accessToken);
    },

    wipeLocal: async () => {
      clearProactive();
      set({ accessToken: null, profile: null, status: "logged-out" });
      try {
        if (isTauriRuntime()) await rustSessionClear();
        else {
          await secureRemoveItemAsync(ACCESS_KEY);
          await secureRemoveItemAsync(REFRESH_KEY);
        }
      } catch {
        /* wipe is best-effort */
      }
    },

    logout: async () => {
      try {
        if (isTauriRuntime()) await rustAuthLogout(API_BASE_URL);
        else {
          const rt = await secureGetItemAsync(REFRESH_KEY).catch(() => null);
          if (rt) {
            await rawPost("/auth/logout", { refreshToken: rt }, null, 10_000).catch(() => undefined);
          }
        }
      } finally {
        await get().wipeLocal();
      }
    },

    refreshNow: () => {
      if (inflightRefresh) return inflightRefresh;
      inflightRefresh = (async (): Promise<string> => {
        const expected = get().accessToken;
        try {
          if (isTauriRuntime()) {
            const fresh = await rustAuthRefresh(API_BASE_URL, expected);
            set({ accessToken: fresh, online: true });
            await persist(fresh, undefined, get().profile).catch(() => undefined);
            scheduleProactive(fresh);
            return fresh;
          }
          const rt = await secureGetItemAsync(REFRESH_KEY).catch(() => null);
          if (!rt) throw toError("NO_REFRESH_TOKEN", "No refresh token in session", 401);
          let data: { accessToken: string; refreshToken?: string };
          try {
            data = await rawPost("/auth/refresh", { refreshToken: rt }, null, 10_000);
          } catch (e) {
            if (isDefinitiveLogout(verdictOf(e))) {
              await secureRemoveItemAsync(ACCESS_KEY).catch(() => undefined);
              await secureRemoveItemAsync(REFRESH_KEY).catch(() => undefined);
              set({ accessToken: null, profile: null, status: "logged-out" });
            }
            throw e;
          }
          await get().setSession({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken ?? rt,
          });
          return data.accessToken;
        } catch (e) {
          if (isTauriRuntime() && isDefinitiveLogout(verdictOf(e))) {
            // Another instance may have rotated already — re-read once and
            // adopt instead of wiping a live session.
            try {
              const latest = await rustSessionGet();
              if (latest?.access_token && latest.access_token !== expected) {
                set({ accessToken: latest.access_token, profile: parseProfile(latest.profile_json) ?? get().profile });
                scheduleProactive(latest.access_token);
                return latest.access_token;
              }
            } catch {
              /* fall through to wipe */
            }
            await get().wipeLocal();
          }
          throw e;
        } finally {
          inflightRefresh = null;
        }
      })();
      return inflightRefresh;
    },

    revalidate: async () => {
      const token = get().accessToken;
      if (!token) return;
      try {
        const user = await rawGetMe(token);
        if (user.role && user.role !== "student") {
          await get().wipeLocal();
          return;
        }
        const profile: StoredProfile = {
          id: user.id,
          name: typeof user.name === "string" ? user.name : null,
          phone: typeof user.phone === "string" ? user.phone : null,
          role: user.role,
        };
        set({ profile, online: true });
        await persist(token, undefined, profile).catch(() => undefined);
      } catch (e) {
        if (isDefinitiveLogout(verdictOf(e))) {
          await get().wipeLocal();
        } else {
          // Network/timeout/5xx: stay signed in on the cached profile.
          set({ online: typeof navigator === "undefined" ? true : navigator.onLine });
        }
      }
    },
  };
});

/** Sync in-memory access token for hot paths (request headers). */
export function getSessionAccessToken(): string | null {
  return useSessionStore.getState().accessToken;
}
