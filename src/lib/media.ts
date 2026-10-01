import { useEffect, useState } from "react";
import { getAccessToken, refresh } from "./api";

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
  const attempt = async (token: string | null): Promise<Response> =>
    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
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
 * Load a remote media URL into a Blob URL. Re-fetches when `sourceUrl`
 * changes and revokes the object URL on cleanup. `blob:`/`data:` inputs
 * pass through untouched (no auth fetch needed).
 */
export function useBlobMedia(sourceUrl: string | null): BlobMediaState {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!sourceUrl) {
      setLoading(false);
      return;
    }
    if (/^(blob|data):/i.test(sourceUrl)) {
      setUrl(sourceUrl);
      setLoading(false);
      return;
    }
    let dead = false;
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true);
    fetchAuthenticatedMedia(sourceUrl, ctrl.signal)
      .then((blob) => {
        if (dead) return;
        objectUrl = URL.createObjectURL(blob);
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
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl]);

  return { url, loading, error };
}
