import { get } from "./api";
import { isSafeHttpUrl } from "./secure-storage";

/**
 * Bundled desktop version — must match package.json + tauri.conf.json.
 * Used only when the Tauri runtime API is unavailable (plain browser dev).
 *
 * A stale value here makes the app compare itself against an older release and
 * show a bogus "New version available" toast, so it is asserted against
 * package.json in version.test.ts.
 */
export const APP_VERSION = "1.0.12";

/**
 * Current release of the manual-installer channel. The signed in-place updater
 * is not advertised for every build, so the toast can fall back to the
 * published installer of exactly this version — never of another one.
 */
export const DESKTOP_INSTALLER_VERSION = "1.0.11";
export const DESKTOP_INSTALLER_URL =
  "https://github.com/bestwayec/bw-tauri/releases/download/v1.0.11/Bestway.App_1.0.11_x64-setup.exe";

export interface DesktopRelease {
  version: string;
  downloadUrl: string | null;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  downloadUrl: string | null;
  body?: string | null;
  date?: string | null;
  /**
   * Where the toast's version came from: the signed updater's `latest.json`
   * (installs in place) or a backend announcement whose installer URL was
   * confirmed to exist (opens the browser).
   */
  source?: "updater" | "installer";
}

/** Minimal shape of `@tauri-apps/plugin-updater`'s `Update` used by the toast. */
export interface SignedUpdate {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
  downloadAndInstall: (
    onEvent?: (e: { event: string; data?: unknown }) => void,
  ) => Promise<void>;
}

/** Runtime app version via Tauri, bundled constant otherwise. Never throws. */
export async function getCurrentVersion(): Promise<string> {
  try {
    const mod = await import("@tauri-apps/api/app");
    const v = await mod.getVersion();
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
    /* outside Tauri (vite browser dev) — fall through to the constant */
  }
  return APP_VERSION;
}

const SEMVER_RE = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

let activeExamUpdateLock = false;

/** Set app-level update install lock while an examination or recovery is active. */
export function setUpdateInstallBlocked(blocked: boolean): void {
  activeExamUpdateLock = blocked;
}

/** True whenever installing/relaunching an update must be deferred. */
export function isUpdateInstallBlocked(): boolean {
  return activeExamUpdateLock;
}

/** Semver-aware compare (handles prereleases like 2.0.0-rc.1 < 2.0.0): -1 when a<b, 0 equal, 1 when a>b. */
export function compareVersions(a: string, b: string): number {
  const ma = a.trim().match(SEMVER_RE);
  const mb = b.trim().match(SEMVER_RE);
  const coreA = (ma?.[1] ?? a).split(".").map((x) => parseInt(x, 10));
  const coreB = (mb?.[1] ?? b).split(".").map((x) => parseInt(x, 10));
  const n = Math.max(coreA.length, coreB.length);
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(coreA[i]) ? (coreA[i] as number) : 0;
    const y = Number.isFinite(coreB[i]) ? (coreB[i] as number) : 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  const preA = ma?.[2];
  const preB = mb?.[2];
  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  const partsA = preA.split(".");
  const partsB = preB.split(".");
  const m = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < m; i++) {
    const sa = partsA[i];
    const sb = partsB[i];
    if (sa === undefined) return -1;
    if (sb === undefined) return 1;
    const na = /^\d+$/.test(sa) ? parseInt(sa, 10) : null;
    const nb = /^\d+$/.test(sb) ? parseInt(sb, 10) : null;
    if (na !== null && nb !== null) {
      if (na < nb) return -1;
      if (na > nb) return 1;
    } else if (na !== null) {
      return -1;
    } else if (nb !== null) {
      return 1;
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/**
 * True only when the backend advertises a strictly newer version.
 * Same-or-older announcements and malformed/empty versions never nag.
 */
export function shouldNotifyUpdate(current: string, latest: string): boolean {
  const next = typeof latest === "string" ? latest.trim() : "";
  const now = typeof current === "string" ? current.trim() : "";
  if (!next || !now) return false;
  if (!SEMVER_RE.test(next) || !SEMVER_RE.test(now)) return false;
  return compareVersions(now, next) < 0;
}

/**
 * Installer URL the toast may open: the backend's URL when it is safe,
 * otherwise the published installer for the advertised version — and never
 * the current installer for a different version.
 */
export function installerUrlFor(latest: string, downloadUrl: string | null): string | null {
  const advertised = typeof downloadUrl === "string" && downloadUrl ? downloadUrl.trim() : null;
  if (advertised && isSafeHttpUrl(advertised)) return advertised;
  const next = typeof latest === "string" ? latest.trim() : "";
  return next === DESKTOP_INSTALLER_VERSION ? DESKTOP_INSTALLER_URL : null;
}

/**
 * Returns update info when the backend advertises a NEWER version,
 * null when up-to-date / unreachable / malformed. Never throws —
 * a failed check must never disturb the student.
 *
 * Security: downloadUrl is validated via isSafeHttpUrl — only https://
 * or http://localhost survive. Unsafe URLs are nulled (no open).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const [current, rel] = await Promise.all([
      getCurrentVersion(),
      get<DesktopRelease>("/desktop-version"),
    ]);
    const latest = typeof rel?.version === "string" ? rel.version.trim() : "";
    if (!latest) return null;
    if (!shouldNotifyUpdate(current, latest)) return null;
    let downloadUrl: string | null =
      typeof rel?.downloadUrl === "string" && rel.downloadUrl ? rel.downloadUrl.trim() : null;
    if (downloadUrl && !isSafeHttpUrl(downloadUrl)) downloadUrl = null;
    return { current, latest, downloadUrl };
  } catch {
    return null;
  }
}

const DISMISSED_KEY = "bestway.dismissedUpdate";

/** Version the student already dismissed (null = none). Never throws. */
export function getDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** Remember a dismissal so the same version never nags again. Never throws. */
export function dismissVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* private mode etc. — notification simply reappears next launch */
  }
}

/** Budget for each network probe; a wedged IPC call must not block the app. */
export const UPDATE_PROBE_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function inTauri(): boolean {
  try {
    return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  } catch {
    return false;
  }
}

/**
 * True only when `url` answers a HEAD request with 2xx. Inside Tauri the
 * native `probe_download_url` command does the request, because the webview
 * cannot read cross-origin statuses. Any error, timeout or non-2xx is false.
 */
export async function probeDownloadUrl(url: string): Promise<boolean> {
  if (!isSafeHttpUrl(url)) return false;
  try {
    if (inTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await withTimeout(invoke<boolean>("probe_download_url", { url }), UPDATE_PROBE_TIMEOUT_MS, "Installer probe")) === true;
    }
    const res = await withTimeout(fetch(url, { method: "HEAD", redirect: "follow", cache: "no-store" }), UPDATE_PROBE_TIMEOUT_MS, "Installer probe");
    return res.ok;
  } catch (err) {
    console.warn("[updater] Installer probe failed:", url, err);
    return false;
  }
}

/** Signed `Update` found by the last `resolveDesktopUpdate`, kept for install. */
let pendingSignedUpdate: SignedUpdate | null = null;

/** The signed update the toast should install (null when none was found). */
export function takeSignedUpdate(): SignedUpdate | null {
  return pendingSignedUpdate;
}

/** Ask the signed updater (`latest.json`) for a newer build. Never throws. */
export async function checkSignedUpdate(): Promise<SignedUpdate | null> {
  try {
    const updater = await import("@tauri-apps/plugin-updater");
    const found = (await withTimeout(updater.check(), UPDATE_PROBE_TIMEOUT_MS, "Update check")) as SignedUpdate | null;
    return found && typeof found.version === "string" && found.version ? found : null;
  } catch (err) {
    console.warn("[updater] Signed update check failed:", err);
    return null;
  }
}

/**
 * Decide whether the update toast may appear, and with which version.
 *
 * 1. Signed updater first: if `latest.json` offers a newer build, the toast
 *    shows THAT version (never the backend's announcement) and installs it
 *    in place.
 * 2. Otherwise the backend announcement is used only if its installer URL
 *    answers HEAD with 2xx. A missing file (404), an unsafe URL or no URL
 *    means no toast at all — the failure is only logged.
 */
export async function resolveDesktopUpdate(): Promise<UpdateInfo | null> {
  pendingSignedUpdate = null;
  const signed = await checkSignedUpdate();
  if (signed) {
    const current = (signed.currentVersion || (await getCurrentVersion())).trim();
    if (!shouldNotifyUpdate(current, signed.version)) return null;
    pendingSignedUpdate = signed;
    return {
      current,
      latest: signed.version.trim(),
      downloadUrl: null,
      body: signed.body ?? null,
      date: signed.date ?? null,
      source: "updater",
    };
  }
  const announced = await checkForUpdate();
  if (!announced) return null;
  const url = installerUrlFor(announced.latest, announced.downloadUrl);
  if (!url) {
    console.warn(`[updater] ${announced.latest} is announced but has no installer URL; toast suppressed`);
    return null;
  }
  if (!(await probeDownloadUrl(url))) {
    console.warn(`[updater] Installer for ${announced.latest} is unreachable (${url}); toast suppressed`);
    return null;
  }
  return { ...announced, downloadUrl: url, source: "installer" };
}
