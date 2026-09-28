import {
  enforceSecureOrigin,
  getMemoryCached,
  primeMemoryCache,
  secureGetItemAsync,
  secureRemoveItemAsync,
  secureSetItemAsync,
} from "./secure-storage";

/**
 * Direct fetch client for the BestWay backend.
 *
 * - Base URL: `VITE_API_URL` or `http://localhost:3001/v1`
 * - Auth: Bearer access token from session (memory + AES-GCM encrypted localStorage)
 * - No Next.js proxy — Tauri talks straight to the backend.
 * - At-rest: tokens are AES-GCM-256 encrypted via crypto.subtle (PBKDF2 120k
 *   from deviceId + per-value salt), format `enc:v2:<salt>:<iv>:<ct>`
 *   (secure-storage.ts). Legacy `enc:v1:` (XOR) / plaintext migrate silently.
 *   When subtle is unavailable, tokens stay memory-only (fail safe).
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

const DEFAULT_BASE_URL = "http://localhost:3001/v1";

function resolveBaseUrl(): string {
  const fromEnv =
    typeof import.meta !== "undefined"
      ? ((import.meta.env?.BESTWAY_API_URL as string | undefined) ??
        (import.meta.env?.VITE_API_URL as string | undefined))
      : undefined;
  const raw = (fromEnv ?? DEFAULT_BASE_URL).trim();
  // Block javascript:/data:/file: injection if env is tampered.
  const lower = raw.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:")
  ) {
    return DEFAULT_BASE_URL;
  }
  return raw.replace(/\/+$/, "");
}

export const API_BASE_URL = resolveBaseUrl();

const ACCESS_KEY = "bestway.accessToken";
const REFRESH_KEY = "bestway.refreshToken";

let memoryAccessToken: string | null = null;
let memoryRefreshToken: string | null = null;

// Warn once if prod build left on cleartext http outside loopback.
try {
  enforceSecureOrigin(API_BASE_URL);
} catch {
  /* ignore */
}

async function readStorage(key: string): Promise<string | null> {
  const v = await secureGetItemAsync(key);
  primeMemoryCache(key, v);
  return v;
}

async function writeStorage(key: string, value: string | null): Promise<void> {
  primeMemoryCache(key, value);
  if (value === null) await secureRemoveItemAsync(key);
  else await secureSetItemAsync(key, value);
}

/** Sync in-memory read for hot paths (request headers). Hydrated by init/set. */
export function getAccessTokenCached(): string | null {
  return memoryAccessToken ?? getMemoryCached(ACCESS_KEY);
}

/** Sync in-memory read for hot paths. Hydrated by init/set. */
export function getRefreshTokenCached(): string | null {
  return memoryRefreshToken ?? getMemoryCached(REFRESH_KEY);
}

export async function getAccessToken(): Promise<string | null> {
  if (memoryAccessToken) return memoryAccessToken;
  const cached = getMemoryCached(ACCESS_KEY);
  if (cached) {
    memoryAccessToken = cached;
    return cached;
  }
  const v = await readStorage(ACCESS_KEY);
  if (v) memoryAccessToken = v;
  return v;
}

export async function getRefreshToken(): Promise<string | null> {
  if (memoryRefreshToken) return memoryRefreshToken;
  const cached = getMemoryCached(REFRESH_KEY);
  if (cached) {
    memoryRefreshToken = cached;
    return cached;
  }
  const v = await readStorage(REFRESH_KEY);
  if (v) memoryRefreshToken = v;
  return v;
}

/** Hydrate in-memory tokens from encrypted disk (runs v1/plaintext migration). */
export async function initSecureSession(): Promise<void> {
  try {
    const [a, r] = await Promise.all([readStorage(ACCESS_KEY), readStorage(REFRESH_KEY)]);
    memoryAccessToken = a;
    memoryRefreshToken = r;
  } catch {
    /* storage failure is non-fatal — session simply starts empty */
  }
}

export async function setSession(
  accessToken: string | null,
  refreshToken?: string | null,
): Promise<void> {
  memoryAccessToken = accessToken;
  await writeStorage(ACCESS_KEY, accessToken);
  if (refreshToken !== undefined) {
    memoryRefreshToken = refreshToken;
    await writeStorage(REFRESH_KEY, refreshToken);
  } else if (accessToken === null) {
    // Clearing the access token without an explicit refresh value must not
    // leave a stale refresh token behind (split-brain logout).
    memoryRefreshToken = null;
    await writeStorage(REFRESH_KEY, null);
  }
}

export async function clearSession(): Promise<void> {
  memoryAccessToken = null;
  memoryRefreshToken = null;
  await writeStorage(ACCESS_KEY, null);
  await writeStorage(REFRESH_KEY, null);
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

  const accessToken = token !== undefined ? token : getAccessTokenCached() ?? (await getAccessToken());
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
    // Transparent refresh like the web proxy (frontend/src/app/api/backend/[...path]/route.ts):
    // on first 401, try POST /auth/refresh once, then retry the original request.
    // Skip for auth endpoints themselves to avoid infinite loops.
    if ((res.status === 401 || err.code === "SESSION_EXPIRED") && !_retried && !isAuthEndpoint) {
      try {
        await refresh();
        return request<T>(path, { ...options, _retried: true });
      } catch {
        // Refresh failed — fall through to the original 401 below.
        // If the refresh token was reused, backend returns SESSION_EXPIRED;
        // wipe local session so the user is forced to re-login.
        if (await getRefreshToken()) {
          // Keep tokens; caller decides. Only wipe when refresh itself says expired.
        }
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

export async function login(phone: string, password: string): Promise<AuthSession> {
  // Defense-in-depth: strip spaces like web login-form.tsx so UI callers
  // can't break lookup with "+998 90 ..." vs stored "+99890...".
  const normalizedPhone = phone.replace(/\s/g, "");
  const session = await post<AuthSession>("/auth/login", { phone: normalizedPhone, password }, { token: null });
  if (session?.accessToken) {
    await setSession(session.accessToken, session.refreshToken ?? null);
  }
  return session;
}

export async function refresh(): Promise<AuthSession> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    throw { code: "NO_REFRESH_TOKEN", message: "No refresh token in session", status: 401 } as ApiError;
  }
  try {
    const session = await post<AuthSession>("/auth/refresh", { refreshToken }, { token: null });
    if (session?.accessToken) {
      await setSession(session.accessToken, session.refreshToken ?? refreshToken);
    }
    return session;
  } catch (e) {
    // Reuse detection / expiry means the whole family is revoked server-side.
    // Wipe local tokens so the UI falls back to login instead of looping 401s.
    const code = (e as ApiError)?.code;
    if (code === "SESSION_EXPIRED" || code === "INVALID_REFRESH_TOKEN") await clearSession();
    throw e;
  }
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
  const refreshToken = await getRefreshToken();
  // No refresh token: local-only logout. POSTing `{}` would make the backend
  // revoke ALL sessions for the user (deleteMany by userId) — not intended.
  if (!refreshToken) {
    await clearSession();
    return;
  }
  try {
    await post<void>("/auth/logout", { refreshToken });
  } catch {
    // Logout is best-effort; always clear local session.
  } finally {
    await clearSession();
  }
}
