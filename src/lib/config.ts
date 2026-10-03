/**
 * Build-time configuration: backend + web origins.
 *
 * Extracted from api.ts so the session store can use it without creating an
 * import cycle (api.ts -> session-store.ts -> config.ts).
 */

const DEFAULT_BASE_URL = "https://api.bestwayec.uz/v1";

function resolveBaseUrl(): string {
  const fromEnv =
    typeof import.meta !== "undefined"
      ? ((import.meta.env?.BESTWAY_API_URL as string | undefined) ??
        (import.meta.env?.VITE_API_URL as string | undefined))
      : undefined;
  const raw = (fromEnv || DEFAULT_BASE_URL).trim();
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

/** True for vite production builds (tauri bundles + `vite build`). */
export function isProdBuild(): boolean {
  try {
    return typeof import.meta !== "undefined" && import.meta.env?.PROD === true;
  } catch {
    return false;
  }
}

/** True when a URL points at this device (dev-only backends). */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Release-build misconfiguration detector: a PRODUCTION bundle talking to
 * loopback can only happen when VITE_API_URL was not provided at build time
 * (see .env.example + release-desktop.yml). Surfaces as a visible banner —
 * students must never silently get an empty exam list from their own machine.
 */
export function isApiMisconfigured(): boolean {
  return isProdBuild() && isLoopbackUrl(API_BASE_URL);
}
