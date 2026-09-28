import { get } from "./api";
import { isSafeHttpUrl } from "./secure-storage";

/**
 * Bundled desktop version — must match package.json + tauri.conf.json.
 * Used only when the Tauri runtime API is unavailable (plain browser dev).
 */
export const APP_VERSION = "0.2.2";

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
    if (compareVersions(current, latest) >= 0) return null;
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
