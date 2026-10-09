import { API_BASE_URL } from './config';

/** Media requests carry credentials, so require the backend's exact origin. */
export function resolveBackendMediaUrl(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.includes('\\') || trimmed.includes('..')) return null;
  try {
    const base = new URL(API_BASE_URL);
    const suffix = trimmed.startsWith('/v1/') ? trimmed.slice(3) : trimmed;
    const url = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`${API_BASE_URL}${suffix.startsWith('/') ? suffix : `/${suffix}`}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
