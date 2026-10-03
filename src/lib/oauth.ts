/**
 * Browser-based login for the Tauri desktop app (PKCE-S256).
 *
 * Flow:
 * 1. Desktop creates state + PKCE verifier, opens SYSTEM BROWSER to
 *    `${WEB_URL}/oauth/desktop?device=...&state=...&code_challenge=...&code_challenge_method=S256&redirect=bestway-exam://auth/callback`
 * 2. Student logs in on the web (phone+password, existing backend session).
 * 3. Student approves -> web calls `POST /auth/desktop/authorize`, then
 *    redirects to `bestway-exam://auth/callback?code=...&state=...`
 *    (or shows the code for manual paste when the deep link misses).
 * 4. Desktop catches the deep link (or pasted URL), verifies `state`,
 *    exchanges `code` at `POST /auth/desktop/exchange`, stores session.
 *
 * Security properties:
 * - `verifier` never leaves the desktop except inside the exchange POST body.
 * - `state` is mandatory on every callback path (CSRF protection).
 * - No tokens ever travel in URLs (code-only exchange).
 */

import { post, setSession } from "./api";
import { ensureDeviceId } from "./session";
import { isSafeHttpUrl, secureGetItemAsync, secureRemoveItemAsync, secureSetItemAsync } from "./secure-storage";

export const DESKTOP_SCHEME = "bestway-exam";
export const DESKTOP_CALLBACK = `${DESKTOP_SCHEME}://auth/callback`;

/** Web origin — NEVER derived from the API URL (api.bestwayec.uz vs bestwayec.uz differ in prod).
 * Production default is https://bestwayec.uz (override with VITE_WEB_URL for local dev). */
function webBaseUrl(): string {
  const fromEnv =
    typeof import.meta !== "undefined"
      ? ((import.meta.env?.BESTWAY_WEB_URL as string | undefined) ??
        (import.meta.env?.VITE_WEB_URL as string | undefined))
      : undefined;
  const raw = (fromEnv || "https://bestwayec.uz").trim().replace(/\/+$/, "");
  // Block javascript:/data: injection via env tampering; fallback to default.
  const lower = raw.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:")
  ) {
    return "https://bestwayec.uz";
  }
  return raw;
}

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE-S256 challenge: BASE64URL(SHA256(verifier ASCII)). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(digest);
}

export interface BrowserLoginState {
  state: string;
  verifier: string;
  deviceId: string;
  createdAt: number;
}

/** Login attempt lifetime — must stay <= backend 5-min code TTL. */
export const OAUTH_STATE_TTL_MS = 5 * 60_000;
const STORAGE_KEY = "bestway.oauth";

function oauthStorage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    /* ignore */
  }
  return null;
}

export async function newBrowserLoginState(): Promise<BrowserLoginState> {
  const s: BrowserLoginState = {
    state: randomToken(16),
    verifier: randomToken(32),
    deviceId: ensureDeviceId(),
    createdAt: Date.now(),
  };
  try {
    // Encrypted at-rest: AES-GCM-256 via secure-storage (PBKDF2 from deviceId
    // + per-value salt, enc:v2). Falls back to memory-only when subtle is
    // unavailable — never plaintext on disk.
    // localStorage survives app restarts / deep-link cold-starts; sessionStorage
    // would vanish when the webview reloads or the app is relaunched by the OS URL handler.
    const payload = JSON.stringify(s);
    try {
      await secureSetItemAsync(STORAGE_KEY, payload);
    } catch {
      oauthStorage()?.setItem(STORAGE_KEY, payload);
    }
  } catch {
    /* private mode — caller keeps `s` in memory */
  }
  return s;
}

export async function readBrowserLoginState(): Promise<BrowserLoginState | null> {
  try {
    // Prefer encrypted store; fallback to legacy plaintext for migration.
    let raw: string | null = null;
    try {
      raw = (await secureGetItemAsync(STORAGE_KEY)) ?? null;
    } catch {
      raw = null;
    }
    if (!raw) raw = oauthStorage()?.getItem(STORAGE_KEY) ?? null;
    if (!raw) return null;
    // Handle double-encrypted envelope edge: if secureGetItemAsync returned envelope
    // that was not decrypted (corrupted), try raw directly.
    let s: BrowserLoginState | null = null;
    try {
      s = JSON.parse(raw) as BrowserLoginState;
    } catch {
      return null;
    }
    if (!s?.state || !s?.verifier || !s?.deviceId) return null;
    if (typeof s.createdAt === "number" && Date.now() - s.createdAt > OAUTH_STATE_TTL_MS) {
      await clearBrowserLoginState();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export async function clearBrowserLoginState(): Promise<void> {
  try {
    try {
      await secureRemoveItemAsync(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    oauthStorage()?.removeItem(STORAGE_KEY);
    // Clean legacy sessionStorage entry if the state was stored there before.
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

export async function buildAuthorizeUrl(s: BrowserLoginState): Promise<string> {
  const q = new URLSearchParams({
    device: s.deviceId,
    state: s.state,
    code_challenge: await codeChallenge(s.verifier),
    code_challenge_method: "S256",
    redirect: DESKTOP_CALLBACK,
  });
  const base = webBaseUrl();
  if (!isSafeHttpUrl(`${base}/`)) {
    throw new Error("Web URL is not safe (must be https:// or http://localhost)");
  }
  return `${base}/oauth/desktop?${q.toString()}`;
}

function isTauriRuntime(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
    );
  } catch {
    return false;
  }
}

/**
 * Open the system browser (Tauri opener).
 * Inside the real Tauri kiosk webview it never falls back to `window.open`
 * (that would trap the login page). Outside Tauri (vite dev in a plain
 * browser) the opener IPC always fails, so fall back to a new tab.
 *
 * Two automatic layers, no user interaction needed:
 * 1. The `opener` plugin (`openUrl`, capability-scoped `https://**`).
 * 2. The app-owned `open_system_browser` Rust command, which enforces its
 *    own strict allowlist (prod hosts + loopback) and bypasses the plugin
 *    capability gate while using the same OS mechanism.
 *
 * Security: validates URL via isSafeHttpUrl (https or loopback http only,
 * no javascript:/data:) before any IPC to prevent open-redirect via XSS.
 */
export async function openInBrowser(url: string): Promise<void> {
  if (!isSafeHttpUrl(url)) {
    throw new Error("Blocked unsafe URL: only https:// or http://localhost allowed.");
  }
  if (!isTauriRuntime()) {
    // Dev/preview in a normal browser: opener plugin has no IPC backend.
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) return;
    throw new Error("Popup blocked by the browser.");
  }
  try {
    const mod = await import("@tauri-apps/plugin-opener");
    await mod.openUrl(url);
    return;
  } catch (e) {
    console.error("[oauth] opener plugin failed, trying Rust fallback:", e);
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_system_browser", { url });
  } catch (e2) {
    const reason = e2 instanceof Error && e2.message ? e2.message : String(e2);
    throw new Error(`System browser could not be opened (${reason})`);
  }
}

export interface StartedBrowserLogin {
  state: BrowserLoginState;
  authorizeUrl: string;
}

export async function startBrowserLogin(): Promise<StartedBrowserLogin> {
  const s = await newBrowserLoginState();
  const authorizeUrl = await buildAuthorizeUrl(s);
  await openInBrowser(authorizeUrl);
  return { state: s, authorizeUrl };
}

export interface DesktopExchangeResponse {
  user: { id: string; [k: string]: unknown };
  accessToken: string;
  refreshToken: string;
}

export async function exchangeCode(code: string, verifier: string, deviceId: string) {
  const session = await post<DesktopExchangeResponse>(
    "/auth/desktop/exchange",
    { code, verifier, deviceId },
    { token: null },
  );
  if (session?.accessToken) await setSession(session.accessToken, session.refreshToken ?? null);
  return session;
}

export interface AuthCallbackParams {
  code?: string;
  state?: string;
  error?: string;
}

/**
 * Parse `bestway-exam://auth/callback?...` into params. Pure — unit-testable.
 * Accepts query (`?...`) and hash (`#...` / `#?...`) forms, plus the opaque
 * `bestway-exam:auth/callback?...` shape some platforms deliver.
 */
export function parseAuthCallbackUrl(url: string): AuthCallbackParams {
  try {
    const normalized = url.replace(/^([a-z][a-z0-9+.-]*):(?!\/\/)/i, "$1://");
    const u = new URL(normalized);
    const q = u.searchParams;
    const hash = new URLSearchParams(u.hash.replace(/^#\??/, ""));
    const pick = (k: string) => q.get(k) ?? hash.get(k) ?? undefined;
    const out: AuthCallbackParams = {
      code: pick("code"),
      state: pick("state"),
      error: pick("error"),
    };
    if (!out.code && !out.error) return { error: "Unrecognized callback URL" };
    return out;
  } catch {
    return { error: "Unrecognized callback URL" };
  }
}

/**
 * True only for our OAuth callback, not any URL with our scheme.
 * Accepts `bestway-exam://auth/callback?...` and the opaque
 * `bestway-exam:auth/callback?...` shape some platforms deliver.
 */
export function isDesktopCallbackUrl(url: string): boolean {
  try {
    const normalized = url.replace(/^([a-z][a-z0-9+.-]*):(?!\/\/)/i, "$1://");
    const u = new URL(normalized);
    return (
      u.protocol.replace(/:$/, "").toLowerCase() === DESKTOP_SCHEME.toLowerCase() &&
      `${u.host}${u.pathname}`.replace(/\/+$/, "").toLowerCase() === "auth/callback"
    );
  } catch {
    return url.trim().toLowerCase().startsWith(`${DESKTOP_SCHEME.toLowerCase()}:`);
  }
}

/**
 * Manual-paste helper: accepts either the FULL callback URL
 * (`bestway-exam://auth/callback?code=..&state=..`) or a RAW code
 * (what the web "copy code" button puts on the clipboard).
 * Raw codes are combined with the stored `state` for CSRF protection.
 */
export function parseManualCallbackInput(
  input: string,
  stored: BrowserLoginState | null,
): AuthCallbackParams {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Paste the full callback URL from the browser first." };
  if (!trimmed.includes("://") && !trimmed.toLowerCase().startsWith(`${DESKTOP_SCHEME}:`)) {
    // Raw code paste — web shows code-only fallback.
    const code = trimmed.split(/\s+/)[0];
    if (!code) return { error: "No code in callback URL." };
    if (!stored?.state) return { error: "Login session expired. Start browser login again." };
    return { code, state: stored.state };
  }
  return parseAuthCallbackUrl(trimmed);
}

export type DeepLinkUnlisten = () => void;

/**
 * Cold-start links: URLs that launched the app (before any listener ran).
 * Returns them (empty when none / outside Tauri).
 */
export async function readInitialDeepLink(): Promise<string[]> {
  try {
    const mod = await import("@tauri-apps/plugin-deep-link");
    if (typeof mod.getCurrent !== "function") return [];
    const raw: unknown = await mod.getCurrent();
    // Plugin versions differ: string[] | string | null.
    const urls: string[] = Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : [];
    return urls.filter((u) => typeof u === "string" && isDesktopCallbackUrl(u));
  } catch {
    return [];
  }
}

/**
 * Listen for the OS deep-link callback. Resolves once with the callback URL.
 * Unsubscribes on resolve AND on timeout (no listener leak).
 * Rejects on timeout — caller should offer manual paste of the FULL callback URL.
 */
export async function waitForDeepLink(timeoutMs = 120_000): Promise<string> {
  const mod = await import("@tauri-apps/plugin-deep-link");
  return new Promise<string>((resolve, reject) => {
    let done = false;
    let unlisten: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        unlisten?.();
      } catch {
        /* ignore */
      }
      fn();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for browser login. Paste the full callback URL manually.")));
    }, timeoutMs);

    void Promise.resolve(mod.onOpenUrl((urls) => {
      const hit = (urls ?? []).find((u) => typeof u === "string" && isDesktopCallbackUrl(u));
      if (hit) finish(() => resolve(hit));
    })).then(
      (u) => {
        unlisten = typeof u === "function" ? u : undefined;
        if (done) {
          try {
            unlisten?.();
          } catch {
            /* ignore */
          }
        }
      },
      () => {
        finish(() => reject(new Error("Deep-link listener unavailable in this build.")));
      },
    );
  });
}

export function listenDeepLink(cb: (url: string) => void): Promise<DeepLinkUnlisten> {
  return import("@tauri-apps/plugin-deep-link").then((mod) =>
    mod.onOpenUrl((urls) => {
      for (const u of urls ?? []) {
        if (typeof u === "string" && isDesktopCallbackUrl(u)) cb(u);
      }
    }),
  );
}

/**
 * Windows/Linux second-instance fallback: when the app is already running,
 * the OS launches a second process with the callback URL as argv. Rust
 * forwards it via the `single-instance` event (see src-tauri/src/main.rs).
 * Without this, warm-start logins hang forever on "Waiting for browser…".
 */
export function listenSingleInstance(cb: (url: string) => void): Promise<DeepLinkUnlisten> {
  return import("@tauri-apps/api/event").then((mod) =>
    mod.listen<string[]>("single-instance", (e) => {
      for (const u of e.payload ?? []) {
        if (typeof u === "string" && isDesktopCallbackUrl(u)) cb(u);
      }
    }),
  );
}
