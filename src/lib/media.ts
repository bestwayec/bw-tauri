import { useEffect, useState } from "react";
import { getAccessToken, refresh } from "./api";
import { resolveBackendMediaUrl } from './media-url';

/**
 * Authenticated media loading for exam audio/images.
 *
 * `<audio src>` and `<img src>` cannot send `Authorization: Bearer`, but the
 * backend only serves group audio/images publicly for demo exams — normal
 * exams require the student token (and timed listening needs `?attemptId=`
 * for replay counting, which the URL builders already append). So media is
 * fetched through the API client and handed to the element as a Blob URL
 * (allowed by the CSP: `media-src`/`img-src` include `blob:`).
 */

export interface MediaLoadError {
  code: string;
  message: string;
  status: number;
}

function toMediaError(status: number): MediaLoadError {
  return {
    code: `HTTP_${status}`,
    message: status === 401 ? "Not authorized for this media (signed in?)" : `Media load failed: ${status}`,
    status,
  };
}

/** Raw authenticated GET with one transparent refresh on 401. */
export async function fetchAuthenticatedMedia(url: string, signal?: AbortSignal): Promise<Blob> {
  const destination = resolveBackendMediaUrl(url);
  if (!destination) throw { code: 'UNSAFE_MEDIA_URL', message: 'Media URL must use the backend origin', status: 400 };
  const attempt = async (token: string | null): Promise<Response> =>
    fetch(destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
      redirect: 'error',
    });

  let res = await attempt(await getAccessToken());
  if (res.status === 401) {
    // Single-flight refresh (throws when no session or verdict definitive).
    try {
      await refresh();
    } catch {
      /* refresh failed — fall through to the 401 below */
    }
    res = await attempt(await getAccessToken());
  }
  if (!res.ok) throw toMediaError(res.status);
  return await res.blob();
}

export interface BlobMediaState {
  /** Blob URL ready for src, or null while loading/failed. */
  url: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Global in-memory Blob cache (sourceUrl -> objectUrl).
 * Once an audio URL is fetched as a Blob, the object URL is cached so subsequent
 * renders or part switches reuse the cached Blob URL with 0ms network latency!
 */
export const mediaBlobCache = new Map<string, string>();

/** Helper to retrieve or preload a cached Blob URL. */
export async function getOrFetchCachedBlobUrl(url: string, signal?: AbortSignal): Promise<string> {
  const cached = mediaBlobCache.get(url);
  if (cached) return cached;
  const blob = await fetchAuthenticatedMedia(url, signal);
  const objectUrl = URL.createObjectURL(blob);
  mediaBlobCache.set(url, objectUrl);
  return objectUrl;
}

/** Clear all cached Blob URLs and revoke object URLs. */
export function clearMediaBlobCache(): void {
  for (const objectUrl of mediaBlobCache.values()) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  }
  mediaBlobCache.clear();
}

/**
 * Load a remote media URL into a Blob URL with in-memory caching.
 * Re-fetches only when uncached; `blob:`/`data:` inputs pass through untouched.
 */
export function useBlobMedia(sourceUrl: string | null): BlobMediaState {
  const cached = sourceUrl ? mediaBlobCache.get(sourceUrl) ?? null : null;
  const [url, setUrl] = useState<string | null>(cached);
  const [loading, setLoading] = useState<boolean>(!cached && Boolean(sourceUrl) && !/^(blob|data):/i.test(sourceUrl ?? ""));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceUrl) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (/^(blob|data):/i.test(sourceUrl)) {
      setUrl(sourceUrl);
      setError(null);
      setLoading(false);
      return;
    }

    const hit = mediaBlobCache.get(sourceUrl);
    if (hit) {
      setUrl(hit);
      setError(null);
      setLoading(false);
      return;
    }

    setUrl(null);
    setError(null);
    setLoading(true);

    let dead = false;
    const ctrl = new AbortController();
    fetchAuthenticatedMedia(sourceUrl, ctrl.signal)
      .then((blob) => {
        if (dead) return;
        const objectUrl = URL.createObjectURL(blob);
        mediaBlobCache.set(sourceUrl, objectUrl);
        setUrl(objectUrl);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (dead) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        const err = e as Partial<MediaLoadError>;
        setError(
          typeof err?.message === "string" && err.message
            ? `${typeof err?.code === "string" ? `${err.code}: ` : ""}${err.message}`
            : "Media failed to load. Check connection.",
        );
        setLoading(false);
      });

    return () => {
      dead = true;
      ctrl.abort();
    };
  }, [sourceUrl]);

  return { url, loading, error };
}
