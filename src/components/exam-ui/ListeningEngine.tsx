import { useEffect, useRef, useState } from "react";
import { useBlobMedia } from "@/lib/media";
import { getVolume, setVolume } from "@/lib/volume";
import { fmtCountdown, parseAudioStartSec } from "./model";

const REVIEW_SEC = 45;

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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reviewLeft, setReviewLeft] = useState<number | null>(null);
  const [vol, setVol] = useState(() => getVolume());
  const doneRef = useRef(false);
  const lastTimeRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onReviewRef = useRef(onReviewComplete);
  onReviewRef.current = onReviewComplete;

  const resolvedStartSec = parseAudioStartSec(audioStartSec, stimulusRef);

  useEffect(() => {
    setStarted(false);
    setEnded(false);
    setCurrentTime(0);
    setDuration(0);
    setReviewLeft(null);
    doneRef.current = false;
    lastTimeRef.current = 0;
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
    if (strict) setReviewLeft(REVIEW_SEC); // Official 45s review buffer before auto-transition
  }

  function handleLoadedMetadata() {
    if (audioRef.current && audioRef.current.duration && !isNaN(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
    if (resolvedStartSec != null && audioRef.current) {
      seekAudioToPartStart(audioRef.current, resolvedStartSec);
    }
  }

  function handleTimeUpdate() {
    if (!audioRef.current) return;
    const cur = audioRef.current.currentTime;
    setCurrentTime(cur);
    lastTimeRef.current = cur;
    if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
  }

  // Anti-tamper: prevent pausing while playing in strict mode
  function handlePause() {
    if (strict && started && !ended && audioRef.current) {
      void audioRef.current.play().catch(() => undefined);
    }
  }

  // Anti-tamper: prevent manual seeking in strict mode
  function handleSeeking() {
    if (strict && started && !ended && audioRef.current) {
      if (Math.abs(audioRef.current.currentTime - lastTimeRef.current) > 2) {
        audioRef.current.currentTime = lastTimeRef.current;
      }
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

  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

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
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePause}
        onSeeking={handleSeeking}
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

      {/* Real-time Tamper-Proof Progress Bar */}
      <div className="w-full my-2 pointer-events-none select-none">
        <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden border border-white/5">
          <div
            className="bg-emerald-500 h-full transition-all duration-150 ease-linear rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-[10px] font-mono text-white/60 mt-1">
          <span>{fmtCountdown(currentTime * 1000)}</span>
          <span>{duration > 0 ? fmtCountdown(duration * 1000) : "--:--"}</span>
        </div>
      </div>

      <div className="exam-audio-row flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void playOnce()}
          disabled={started}
          className={`exam-btn-primary px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            started ? "opacity-60 cursor-not-allowed" : "shadow-lg shadow-emerald-500/20 active:scale-95"
          }`}
        >
          {started ? (ended ? "Audio completed (played once)" : "Playing… (tamper-proof)") : "▶ Play audio (strictly once)"}
        </button>
        <label className="exam-vol flex items-center gap-1.5 text-xs text-white/70">
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
          <span
            className="exam-review px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono font-bold animate-pulse"
            aria-live="polite"
          >
            Review: {fmtCountdown(reviewLeft * 1000)} (Auto-next)
          </span>
        )}
      </div>
      <p className="exam-audio-note text-[11px] text-white/50 mt-1">
        In this official section, the recording plays <strong>strictly once</strong>. Seeking and pausing are disabled.
      </p>
    </div>
  );
}
