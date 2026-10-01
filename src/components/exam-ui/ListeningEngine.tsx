import { useEffect, useRef, useState } from "react";
import { useBlobMedia } from "@/lib/media";
import { getVolume, setVolume } from "@/lib/volume";
import { fmtCountdown } from "./model";

const REVIEW_SEC = 120;

type Props = {
  /** Remote group audio URL (may include ?attemptId= for replay counting). */
  src: string | null;
  title: string;
  /** Timed exam: play once, no pause/seek, then a 2:00 review countdown. */
  strict: boolean;
  onEnded?: () => void;
  onReviewComplete?: () => void;
};

/**
 * Listening audio engine. Strict mode mirrors the real test (play once,
 * volume only, review countdown, auto-advance hook); practice mode keeps
 * native controls with unlimited replay.
 */
export default function ListeningEngine({ src, title, strict, onEnded, onReviewComplete }: Props) {
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

  useEffect(() => {
    setStarted(false);
    setEnded(false);
    setReviewLeft(null);
    doneRef.current = false;
  }, [src]);

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
        <p className="exam-audio-title">{title}</p>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions track below */}
        <audio controls src={media.url} preload="none" onEnded={handleEnded} className="exam-audio-el">
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
        onEnded={handleEnded}
        onContextMenu={(e) => e.preventDefault()}
      >
        <track kind="captions" />
      </audio>
      <p className="exam-audio-title">{title}</p>
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
