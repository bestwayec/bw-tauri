export const DEFAULT_API_BASE_URL = "https://api.bestwayec.uz/v1";

/** Credential-bearing requests must never use cleartext outside local development. */
export function validateApiBaseUrl(raw: string, development: boolean): string {
  const value = raw.trim();
  const url = new URL(value);
  if (/[\u0000-\u001f\u007f]/.test(raw) || url.username || url.password || url.search || url.hash
      || !(url.protocol === 'https:' || (development && url.protocol === 'http:' && isLoopbackUrl(value)))) {
    throw new Error('API URL must use HTTPS (loopback HTTP is allowed only in development), without credentials, query or fragment.');
  }
  return value.replace(/\/+$/, '');
}

/** True when a URL points at this device (dev-only backends). */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}
