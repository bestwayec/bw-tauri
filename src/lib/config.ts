/**
 * Build-time configuration: backend + web origins.
 *
 * Extracted from api.ts so the session store can use it without creating an
 * import cycle (api.ts -> session-store.ts -> config.ts).
 */

import { DEFAULT_API_BASE_URL, isLoopbackUrl, validateApiBaseUrl } from "./api-origin";

export { isLoopbackUrl, validateApiBaseUrl } from "./api-origin";

function resolveBaseUrl(): string {
  const fromEnv =
    typeof import.meta !== "undefined"
      ? ((import.meta.env?.BESTWAY_API_URL as string | undefined) ??
        (import.meta.env?.VITE_API_URL as string | undefined))
      : undefined;
  const raw = (fromEnv || DEFAULT_API_BASE_URL).trim();
  return validateApiBaseUrl(raw, import.meta.env?.DEV === true);
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

/**
 * Release-build misconfiguration detector: a PRODUCTION bundle talking to
 * loopback can only happen when VITE_API_URL was not provided at build time
 * (see .env.example + release-desktop.yml). Surfaces as a visible banner —
 * students must never silently get an empty exam list from their own machine.
 */
export function isApiMisconfigured(): boolean {
  return isProdBuild() && isLoopbackUrl(API_BASE_URL);
}
