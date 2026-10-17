import { useEffect, useRef, useState } from "react";
import { useBlobMedia } from "@/lib/media";
import { getVolume, setVolume } from "@/lib/volume";
import { fmtCountdown, parseAudioStartSec } from "./model";

const REVIEW_SEC = 120;

type Props = {
  /** Remote group audio URL (may include ?attemptId= for replay counting). */
  src: string | null;
  title: string;
  /** Timed exam: play once, no pause/seek, then a 2:00 review countdown. */
  strict: boolean;
  /** Optional part timestamp in seconds (or via stimulusRef JSON {"startSec": ...}). */
  audioStartSec?: number | null;
  stimulusRef?: string | Record<string, unknown> | null;
  onEnded?: () => void;
  onReviewComplete?: () => void;
};

/**
 * Seek an HTMLAudioElement-like object to the resolved start timestamp (if any).
 * Exported as a pure helper for unit testing.
 */
export function seekAudioToPartStart(
  audio: { currentTime: number } | null | undefined,
  audioStartSec?: number | null,
  stimulusRef?: string | Record<string, unknown> | null,
): number | null {
  const startSec = parseAudioStartSec(audioStartSec, stimulusRef);
  if (startSec == null || !audio) return startSec;
  try {
    audio.currentTime = startSec;
  } catch {
    /* ignore if media not yet seekable */
  }
  return startSec;
}

/**
 * Listening audio engine. Strict mode mirrors the real test (play once,
 * volume only, review countdown, auto-advance hook); practice mode keeps
 * native controls with unlimited replay. Supports single-audio part timestamps.
 */
export default function ListeningEngine({
  src,
  title,
  strict,
  audioStartSec,
  stimulusRef,
  onEnded,
  onReviewComplete,
}: Props) {
  const media = useBlobMedia(src);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [reviewLeft, setReviewLeft] = useState<number | null>(null);
  const [vol, setVol] = useState(() => getVolume());
  const doneRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onReviewRef = useRef(onReviewComplete);
  onReviewRef.current = onReviewComplete;

  const resolvedStartSec = parseAudioStartSec(audioStartSec, stimulusRef);

  useEffect(() => {
    setStarted(false);
    setEnded(false);
    setReviewLeft(null);
    doneRef.current = false;
  }, [src]);

  // When switching parts on a shared single audio track (or when startSec changes),
  // automatically seek to the part's start timestamp.
  useEffect(() => {
    if (resolvedStartSec != null && audioRef.current) {
      seekAudioToPartStart(audioRef.current, resolvedStartSec);
    }
  }, [resolvedStartSec, title, media.url]);

  useEffect(() => {
    if (reviewLeft == null) return;
    if (reviewLeft <= 0) {
      if (!doneRef.current) {
        doneRef.current = true;
        onReviewRef.current?.();
      }
      return;
    }
    const id = window.setTimeout(() => setReviewLeft((v) => (v == null ? v : v - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [reviewLeft]);

  function changeVol(v: number) {
    setVol(v);
    setVolume(v); // syncs the TopBar slider via VOLUME_EVENT
    if (audioRef.current) audioRef.current.volume = v / 100;
  }

  async function playOnce() {
    const el = audioRef.current;
    if (!el || started) return;
    setStarted(true);
    try {
      el.volume = getVolume() / 100;
      if (resolvedStartSec != null) {
        seekAudioToPartStart(el, resolvedStartSec);
      }
      await el.play();
    } catch {
      setStarted(false);
    }
  }

  function handleEnded() {
    setEnded(true);
    onEndedRef.current?.();
    if (strict) setReviewLeft(REVIEW_SEC);
  }

  function handleLoadedMetadata() {
    if (resolvedStartSec != null && audioRef.current) {
      seekAudioToPartStart(audioRef.current, resolvedStartSec);
    }
  }

  if (!src) {
    return (
      <p className="exam-audio-empty">
        No audio attached to this part. Answer from the material below.
      </p>
    );
  }
  if (media.loading) {
    return (
      <p className="exam-audio-empty" role="status">
        Loading audio…
      </p>
    );
  }
  if (media.error || !media.url) {
    return (
      <p className="exam-audio-error" role="alert">
        Audio failed to load: {media.error ?? "Unknown media error."}
      </p>
    );
  }

  if (!strict) {
    return (
      <div className="exam-audio">
        <div className="flex items-center justify-between gap-2">
          <p className="exam-audio-title">{title}</p>
          {resolvedStartSec != null && (
            <span className="text-[11px] font-mono opacity-70">
              Part start: {fmtCountdown(resolvedStartSec * 1000)}
            </span>
          )}
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions track below */}
        <audio
          ref={audioRef}
          controls
          src={media.url}
          preload="none"
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          className="exam-audio-el"
        >
          <track kind="captions" />
        </audio>
      </div>
    );
  }

  return (
    <div className="exam-audio exam-audio-strict">
      {/* Hidden element: no native controls means no pause/seek UI. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions track below */}
      <audio
        ref={audioRef}
        src={media.url}
        preload="auto"
        controlsList="nodownload noplaybackrate"
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onContextMenu={(e) => e.preventDefault()}
      >
        <track kind="captions" />
      </audio>
      <div className="flex items-center justify-between gap-2">
        <p className="exam-audio-title">{title}</p>
        {resolvedStartSec != null && (
          <span className="text-[11px] font-mono opacity-70">
            Part start: {fmtCountdown(resolvedStartSec * 1000)}
          </span>
        )}
      </div>
      <div className="exam-audio-row">
        <button type="button" onClick={() => void playOnce()} disabled={started} className="exam-btn-primary">
          {started ? (ended ? "Played once" : "Playing… (once only)") : "▶ Play audio (once only)"}
        </button>
        <label className="exam-vol">
          🔊
          <input
            type="range"
            min={0}
            max={100}
            value={vol}
            onChange={(e) => changeVol(Number(e.target.value))}
            aria-label="Volume"
            className="exam-range-sm"
          />
        </label>
        {reviewLeft != null && reviewLeft > 0 && (
          <span className="exam-review" aria-live="polite">
            Review: {fmtCountdown(reviewLeft * 1000)}
          </span>
        )}
      </div>
      <p className="exam-audio-note">
        In this timed section the recording plays <strong>once only</strong>.
      </p>
    </div>
  );
}
