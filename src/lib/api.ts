import { enforceSecureOrigin } from "./secure-storage";
import { API_BASE_URL } from "./config";
import { getSessionAccessToken, useSessionStore } from "./session-store";

export { API_BASE_URL, isApiMisconfigured, isLoopbackUrl, isProdBuild } from "./config";

/**
 * Direct fetch client for the BestWay backend.
 *
 * - Base URL: `VITE_API_URL` or `http://localhost:3001/v1`
 * - Auth: Bearer access token from the single session store
 *   (session-store.ts; Rust-owned in Tauri, encrypted localStorage in browser)
 * - No Next.js proxy — Tauri talks straight to the backend.
 * - Refresh is single-flight and Rust-owned; the session is wiped ONLY on
 *   definitive backend verdicts, never on network errors.
 * - Network: 15s default timeout (10s auth), https-enforce warning outside loopback.
 */

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  [key: string]: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: ApiMeta;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
}

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

export type QueryParams = Record<string, QueryValue>;

// Warn once if prod build left on cleartext http outside loopback.
try {
  enforceSecureOrigin(API_BASE_URL);
} catch {
  /* ignore */
}

/** Sync in-memory read for hot paths (request headers). Owned by the session store. */
export function getAccessTokenCached(): string | null {
  return getSessionAccessToken();
}

/**
 * Sync in-memory read for hot paths. The refresh token is Rust-owned and
 * never exposed to JS — this always returns null. Kept for compatibility.
 */
export function getRefreshTokenCached(): string | null {
  return null;
}

export async function getAccessToken(): Promise<string | null> {
  return getSessionAccessToken();
}

/** Refresh tokens are Rust-owned (or encrypted at-rest in browser dev) — never exposed. */
export async function getRefreshToken(): Promise<string | null> {
  return null;
}

/** Boot the single session store (migrates legacy storage, revalidates). */
export async function initSecureSession(): Promise<void> {
  await useSessionStore.getState().initialize();
}

export async function setSession(
  accessToken: string | null,
  refreshToken?: string | null,
): Promise<void> {
  if (accessToken === null) {
    await useSessionStore.getState().wipeLocal();
    return;
  }
  await useSessionStore.getState().setSession({ accessToken, refreshToken });
}

export async function clearSession(): Promise<void> {
  await useSessionStore.getState().wipeLocal();
}

/** Build `?a=1&b=2` query string from a params object. Returns `""` when empty. */
export function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  query?: QueryParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic JSON body passthrough (stringified when non-string)
  body?: any;
  token?: string | null;
  /** Internal: skip transparent refresh (used for the retry itself + auth endpoints). */
  _retried?: boolean;
}

function toApiError(status: number, payload: unknown, fallback: string): ApiError {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    // Backend may return { success: false, error: { code, message } } or { code, message }.
    const nested = p.error as Record<string, unknown> | undefined;
    const code =
      (nested?.code as string | undefined) ??
      (p.code as string | undefined) ??
      `HTTP_${status}`;
    const message =
      (nested?.message as string | undefined) ??
      (p.message as string | undefined) ??
      fallback;
    return { code, message, status };
  }
  return { code: `HTTP_${status}`, message: fallback, status };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const AUTH_TIMEOUT_MS = 10_000;

function isAuthPath(path: string): boolean {
  return (
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/refresh") ||
    path.startsWith("/auth/desktop/exchange") ||
    path.startsWith("/auth/register")
  );
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { query, body, token, headers, _retried, signal: callerSignal, ...rest } = options as RequestOptions & { signal?: AbortSignal };
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}${buildQuery(query)}`;

  const accessToken = token !== undefined ? token : getAccessTokenCached();
  const hasJsonBody = body !== undefined && typeof body !== "string";

  const isAuthEndpoint = isAuthPath(path);
  const timeoutMs = isAuthEndpoint ? AUTH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Honor caller signal if provided.
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(headers ?? {}),
      },
      body: body === undefined || typeof body === "string" ? body : JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw { code: "HTTP_TIMEOUT", message: `Request timed out after ${timeoutMs}ms`, status: 408 } as ApiError;
    }
    throw e;
  }
  clearTimeout(timer);

  const text = await res.text();
  const payload: unknown = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const err = toApiError(res.status, payload, `Request failed: ${res.status}`);
    // Transparent single-flight refresh (session-store owns rotation):
    // on first 401, refresh once, then retry the original request.
    // Skip for auth endpoints themselves to avoid infinite loops.
    // The store wipes ONLY on definitive verdicts; transient failures keep
    // the session and fall through to the original error below.
    if ((res.status === 401 || err.code === "SESSION_EXPIRED") && !_retried && !isAuthEndpoint) {
      try {
        await refresh();
        return request<T>(path, { ...options, _retried: true });
      } catch {
        // Refresh failed — fall through to the original 401 below.
      }
    }
    throw err;
  }

  // Backend wraps data as ApiResponse<T>; unwrap to T for callers.
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    return (payload as ApiResponse<T>).data;
  }
  return payload as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function get<T>(path: string, query?: QueryParams, init?: RequestOptions): Promise<T> {
  return request<T>(path, { ...init, query, method: "GET" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic JSON body passthrough (stringified when non-string)
export function post<T>(path: string, body?: any, init?: RequestOptions): Promise<T> {
  return request<T>(path, { ...init, method: "POST", body });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic JSON body passthrough (stringified when non-string)
export function put<T>(path: string, body?: any, init?: RequestOptions): Promise<T> {
  return request<T>(path, { ...init, method: "PUT", body });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic JSON body passthrough (stringified when non-string)
export function patch<T>(path: string, body?: any, init?: RequestOptions): Promise<T> {
  return request<T>(path, { ...init, method: "PATCH", body });
}

export function del<T>(path: string, query?: QueryParams, init?: RequestOptions): Promise<T> {
  return request<T>(path, { ...init, query, method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  phone: string;
  name?: string;
  role?: string;
  [key: string]: unknown;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

/**
 * Normalize a phone number the way the web login form does, so the desktop
 * never fails lookup on formatting:
 * - strips spaces, dashes, parens (anything except a leading `+`)
 * - adds the `+998` country code for bare 9-digit Uzbek numbers
 *   (`90 123 45 67` -> `+998901234567`)
 * - adds the missing `+` for `998…` input (`998901234567` -> `+998901234567`)
 * Anything else is passed through digit-cleaned for the backend to validate.
 */
export function normalizePhone(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const hasPlus = t.startsWith("+");
  const digits = t.replace(/\D/g, "");
  if (!digits) return t;
  if (hasPlus) return `+${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  if (digits.length === 9) return `+998${digits}`;
  return digits;
}

export async function login(phone: string, password: string): Promise<AuthSession> {
  const normalizedPhone = normalizePhone(phone);
  const session = await post<AuthSession>("/auth/login", { phone: normalizedPhone, password }, { token: null });
  if (session?.accessToken) {
    await useSessionStore.getState().setSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken ?? null,
      profile: session.user?.id
        ? {
            id: session.user.id,
            name: typeof session.user.name === "string" ? session.user.name : null,
            phone: typeof session.user.phone === "string" ? session.user.phone : null,
            role: typeof session.user.role === "string" ? session.user.role : undefined,
          }
        : null,
    });
  }
  return session;
}

/**
 * Single-flight refresh owned by the session store (Rust serializes the
 * actual rotation). Resolves the fresh access token; the store has already
 * wiped the session when the backend verdict is definitive.
 */
export async function refresh(): Promise<string> {
  return useSessionStore.getState().refreshNow();
}

export interface MeResponse {
  user: AuthUser;
  profile?: unknown;
  [key: string]: unknown;
}

export async function me(): Promise<MeResponse> {
  return get<MeResponse>("/auth/me");
}

export async function logout(): Promise<void> {
  // Server revoke (Rust-owned refresh token, or legacy POST) + local wipe.
  // Best-effort either way: explicit sign-out always ends the local session.
  await useSessionStore.getState().logout();
}
