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
export const APP_VERSION = "1.0.9";

/**
 * Current release of the manual-installer channel. The signed in-place updater
 * is not advertised for every build, so the toast can fall back to the
 * published installer of exactly this version — never of another one.
 */
export const DESKTOP_INSTALLER_VERSION = "1.0.9";
export const DESKTOP_INSTALLER_URL =
  "https://bestwayec.uz/media/downloads/Bestway.App_1.0.9_x64-setup.exe";

export interface DesktopRelease {
  version: string;
  downloadUrl: string | null;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  downloadUrl: string | null;
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

/** Numeric dot-separated compare: -1 when a<b, 0 when equal, 1 when a>b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10));
  const pb = b.split(".").map((x) => parseInt(x, 10));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
    const y = Number.isFinite(pb[i]) ? (pb[i] as number) : 0;
    if (x < y) return -1;
    if (x > y) return 1;
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
  // A version that parses to all-zero parts (e.g. "latest", "") is malformed.
  if (!/^\d+(\.\d+)*$/.test(next) || !/^\d+(\.\d+)*$/.test(now)) return false;
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
