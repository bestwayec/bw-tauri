/**
 * Shared audio-volume state for the desktop app.
 *
 * Persisted to localStorage (`bestway.volume`, 0–100) and broadcast via
 * `bestway:volume` so every mounted `<audio>` follows the ElasticSlider
 * without prop-drilling through the question list.
 */

export const VOLUME_KEY = "bestway.volume";
export const VOLUME_EVENT = "bestway:volume";
export const DEFAULT_VOLUME = 80;

export function getVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null) return DEFAULT_VOLUME;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_VOLUME;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** Persist + apply to all mounted audio tags + notify listeners. */
export function setVolume(value: number): void {
  const v = Math.min(100, Math.max(0, Math.round(value)));
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    /* private mode — memory only */
  }
  try {
    document.querySelectorAll("audio").forEach((el) => {
      el.volume = v / 100;
    });
  } catch {
    /* no DOM yet */
  }
  try {
    window.dispatchEvent(new CustomEvent<number>(VOLUME_EVENT, { detail: v }));
  } catch {
    /* ignore */
  }
}

/**
 * Attach to an `<audio>` ref: applies the stored volume now and follows
 * future slider changes. Returns a cleanup function.
 */
export function bindAudioVolume(el: HTMLAudioElement | null): () => void {
  if (!el) return () => undefined;
  el.volume = getVolume() / 100;
  const onChange = (e: Event) => {
    el.volume = (e as CustomEvent<number>).detail / 100;
  };
  window.addEventListener(VOLUME_EVENT, onChange);
  return () => window.removeEventListener(VOLUME_EVENT, onChange);
}
