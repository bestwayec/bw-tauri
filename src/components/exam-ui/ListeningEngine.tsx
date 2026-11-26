import { useEffect, useRef, useState } from "react";
import { useBlobMedia } from "@/lib/media";
import { supportedAudioCodecs } from "@/lib/audio-capture";
import { getVolume, setVolume, VOLUME_EVENT } from "@/lib/volume";
import { fmtCountdown, parseAudioStartSec } from "./model";

const REVIEW_SEC = 45;
const MAX_AUDIO_RETRIES = 2;

let activeAudioEl: HTMLAudioElement | null = null;

/** Ensure only one exam audio track plays at a time across component switches. */
export function claimExclusiveAudio(el: HTMLAudioElement | null): void {
  if (activeAudioEl && activeAudioEl !== el) {
    try {
      activeAudioEl.pause();
    } catch {
      /* ignore */
    }
  }
  activeAudioEl = el;
}

export function releaseExclusiveAudio(el: HTMLAudioElement | null): void {
  if (activeAudioEl === el) activeAudioEl = null;
}

interface StrictPlaybackState {
  started: boolean;
  ended: boolean;
  lastTime: number;
}

function playbackStorageKey(key: string): string {
  return `examui.audio.${key}`;
}

export function readStrictPlaybackState(key?: string): StrictPlaybackState {
  if (!key || typeof localStorage === "undefined") {
    return { started: false, ended: false, lastTime: 0 };
  }
  try {
    const raw = localStorage.getItem(playbackStorageKey(key));
    if (!raw) return { started: false, ended: false, lastTime: 0 };
    const parsed = JSON.parse(raw) as Partial<StrictPlaybackState>;
    return {
      started: parsed.started === true,
      ended: parsed.ended === true,
      lastTime: typeof parsed.lastTime === "number" && Number.isFinite(parsed.lastTime) ? parsed.lastTime : 0,
    };
  } catch {
    return { started: false, ended: false, lastTime: 0 };
  }
}

export function writeStrictPlaybackState(key: string | undefined, state: StrictPlaybackState): void {
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(playbackStorageKey(key), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

type Props = {
  /** Remote group audio URL (may include ?attemptId= for replay counting). */
  src: string | null;
  title: string;
  /** Timed exam: play once, no pause/seek, then a 2:00 review countdown. */
  strict: boolean;
  /** Optional persistent key (attemptId:partKey) so strict play-once survives restart. */
  playbackKey?: string;
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
  playbackKey,
  audioStartSec,
  stimulusRef,
  onEnded,
  onReviewComplete,
}: Props) {
  const media = useBlobMedia(src);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialStrict = strict ? readStrictPlaybackState(playbackKey) : { started: false, ended: false, lastTime: 0 };
  const [started, setStarted] = useState(initialStrict.started);
  const [ended, setEnded] = useState(initialStrict.ended);
  const [currentTime, setCurrentTime] = useState(initialStrict.lastTime);
  const [duration, setDuration] = useState(0);
  const [reviewLeft, setReviewLeft] = useState<number | null>(null);
  const [vol, setVol] = useState(() => getVolume());
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const lastTimeRef = useRef(initialStrict.lastTime);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onReviewRef = useRef(onReviewComplete);
  onReviewRef.current = onReviewComplete;

  const resolvedStartSec = parseAudioStartSec(audioStartSec, stimulusRef);

  useEffect(() => {
    const persisted = strict ? readStrictPlaybackState(playbackKey) : { started: false, ended: false, lastTime: 0 };
    setStarted(persisted.started);
    setEnded(persisted.ended);
    setCurrentTime(persisted.lastTime);
    setDuration(0);
    setReviewLeft(null);
    setBuffering(false);
    setPlaybackError(null);
    retryCountRef.current = 0;
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    doneRef.current = false;
    lastTimeRef.current = persisted.lastTime;
  }, [src, playbackKey, strict]);

  useEffect(() => {
    const onVol = (e: Event) => {
      const next = (e as CustomEvent<number>).detail;
      setVol(next);
      if (audioRef.current) audioRef.current.volume = next / 100;
    };
    window.addEventListener(VOLUME_EVENT, onVol);
    return () => window.removeEventListener(VOLUME_EVENT, onVol);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (el) {
        try {
          el.pause();
          el.removeAttribute("src");
          el.load();
        } catch {
          /* ignore */
        }
        releaseExclusiveAudio(el);
      }
    };
  }, [src]);

  // When switching parts on a shared single audio track (or when startSec changes),
  // automatically seek to the part's start timestamp (unless resuming strict playback).
  useEffect(() => {
    if (resolvedStartSec != null && audioRef.current && lastTimeRef.current === 0) {
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
    if (!el || ended) return;
    if (started && !playbackError && !el.paused) return;
    setStarted(true);
    setPlaybackError(null);
    if (strict) {
      writeStrictPlaybackState(playbackKey, { started: true, ended: false, lastTime: lastTimeRef.current });
    }
    try {
      claimExclusiveAudio(el);
      el.volume = getVolume() / 100;
      if (lastTimeRef.current > 0) {
        try {
          el.currentTime = lastTimeRef.current;
        } catch {
          /* ignore */
        }
      } else if (resolvedStartSec != null) {
        seekAudioToPartStart(el, resolvedStartSec);
      }
      await el.play();
    } catch {
      if (lastTimeRef.current === 0 && !strict) setStarted(false);
      setPlaybackError("Audio playback blocked or interrupted. Check your headphones and press Resume.");
    }
  }

  function handleEnded() {
    setEnded(true);
    setBuffering(false);
    if (strict) {
      writeStrictPlaybackState(playbackKey, { started: true, ended: true, lastTime: duration || lastTimeRef.current });
    }
    releaseExclusiveAudio(audioRef.current);
    onEndedRef.current?.();
    if (strict) setReviewLeft(REVIEW_SEC); // Official 45s review buffer before auto-transition
  }

  function handleLoadedMetadata() {
    if (audioRef.current && audioRef.current.duration && !isNaN(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
    if (audioRef.current) {
      if (lastTimeRef.current > 0) {
        try { audioRef.current.currentTime = lastTimeRef.current; } catch { /* ignore */ }
      } else if (resolvedStartSec != null) {
        seekAudioToPartStart(audioRef.current, resolvedStartSec);
      }
    }
  }

  function handleTimeUpdate() {
    if (!audioRef.current) return;
    const cur = audioRef.current.currentTime;
    setCurrentTime(cur);
    lastTimeRef.current = cur;
    if (strict && playbackKey && Math.floor(cur) % 3 === 0) {
      writeStrictPlaybackState(playbackKey, { started: true, ended, lastTime: cur });
    }
    if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
  }

  function handleAudioError(e: React.SyntheticEvent<HTMLAudioElement, Event>) {
    setBuffering(false);
    const el = e.currentTarget as HTMLAudioElement;
    const mediaError = el.error;
    let message = "Audio playback interrupted. Check your headphones or sound settings.";
    if (mediaError) {
      if (mediaError.code === 2) {
        if (retryCountRef.current < MAX_AUDIO_RETRIES) {
          retryCountRef.current += 1;
          const delay = retryCountRef.current * 1000;
          setPlaybackError(`Network error while loading audio. Retrying (${retryCountRef.current}/${MAX_AUDIO_RETRIES})…`);
          if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            if (!audioRef.current || ended) return;
            try {
              audioRef.current.load();
              if (lastTimeRef.current > 0) audioRef.current.currentTime = lastTimeRef.current;
              void audioRef.current.play().then(() => setPlaybackError(null)).catch(() => undefined);
            } catch {
              /* handled on next error */
            }
          }, delay);
          return;
        }
        message = "Audio loading failed after retries. Check connection and press Resume.";
      } else if (mediaError.code === 3) {
        const codecs = supportedAudioCodecs();
        message = `Audio decode error (supported codecs: ${codecs.join(", ") || "none"}). Please resume playback.`;
      } else if (mediaError.code === 4) {
        message = "Audio format or source is unavailable on this device.";
      }
    }
    setPlaybackError(message);
  }

  // Anti-tamper: prevent pausing while playing in strict mode
  function handlePause() {
    if (strict && started && !ended && audioRef.current && !playbackError) {
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
          onPlay={() => claimExclusiveAudio(audioRef.current)}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onPlaying={() => { setBuffering(false); setPlaybackError(null); }}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onError={handleAudioError}
          className="exam-audio-el"
        >
          <track kind="captions" />
        </audio>
        {buffering && <p role="status" className="text-[11px] opacity-70 mt-1">Buffering audio…</p>}
        {playbackError && <p role="alert" className="text-[11px] text-amber-300 mt-1">{playbackError}</p>}
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
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => { setBuffering(false); setPlaybackError(null); }}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePause}
        onSeeking={handleSeeking}
        onEnded={handleEnded}
        onError={handleAudioError}
        onContextMenu={(e) => e.preventDefault()}
      >
        <track kind="captions" />
      </audio>
      <div className="flex items-center justify-between gap-2">
        <p className="exam-audio-title">{title}</p>
        <div className="flex items-center gap-2">
          {buffering && <span role="status" className="text-[11px] font-mono text-amber-300">Buffering…</span>}
          {resolvedStartSec != null && (
            <span className="text-[11px] font-mono opacity-70">
              Part start: {fmtCountdown(resolvedStartSec * 1000)}
            </span>
          )}
        </div>
      </div>

      {playbackError && (
        <div className="flex items-center justify-between gap-2 my-2 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs animate-fade-in">
          <span>⚠️ {playbackError}</span>
          <button
            type="button"
            onClick={async () => {
              setPlaybackError(null);
              if (audioRef.current && !ended) {
                try {
                  await audioRef.current.play();
                } catch {
                  setPlaybackError("Unable to resume playback. Please verify your audio output device.");
                }
              }
            }}
            className="underline hover:text-white font-semibold ml-auto"
          >
            Qayta ijro etish (Resume)
          </button>
        </div>
      )}

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
          disabled={(started && !playbackError) || ended}
          className={`exam-btn-primary px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            (started && !playbackError) || ended ? "opacity-60 cursor-not-allowed" : "shadow-lg shadow-emerald-500/20 active:scale-95"
          }`}
        >
          {ended
            ? "Audio completed (played once)"
            : started && playbackError
              ? "▶ Resume interrupted audio"
              : started
                ? "Playing… (tamper-proof)"
                : "▶ Play audio (strictly once)"}
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
