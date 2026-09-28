import { useEffect, useRef, useState } from "react";
import { getVolume, setVolume, VOLUME_EVENT } from "@/lib/volume";

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

type Props = {
  src: string;
  title: string;
  instructions: string | null;
  /**
   * Timed-exam strict mode: play once only — no pause, no seek, no speed
   * change. After `ended`, the play button locks and `onEnded` fires
   * (section review countdown / auto-advance handled by the caller).
   * Practice (default) keeps full controls + replay.
   */
  strict?: boolean;
  onEnded?: () => void;
};

/**
 * Listening material pane: large exam-style player + instructions.
 * Practice-friendly (replay allowed) with a played badge so students learn
 * the real once-only rule without being blocked during practice.
 */
export default function ListeningPane({ src, title, instructions, strict, onEnded }: Props) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(() => getVolume());
  const [rate, setRate] = useState(1);
  const [played, setPlayed] = useState(false);
  const [locked, setLocked] = useState(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    setPlaying(false);
    setCur(0);
    setDur(0);
    setPlayed(false);
    setLocked(false);
    const el = elRef.current;
    if (el) {
      el.pause();
      el.volume = getVolume() / 100;
      el.playbackRate = 1;
    }
    setRate(1);
  }, [src]);

  useEffect(() => {
    const onVol = (e: Event) => setVol((e as CustomEvent<number>).detail);
    window.addEventListener(VOLUME_EVENT, onVol);
    return () => window.removeEventListener(VOLUME_EVENT, onVol);
  }, []);

  useEffect(() => {
    if (elRef.current) elRef.current.playbackRate = rate;
  }, [rate, src]);

  const toggle = () => {
    const el = elRef.current;
    if (!el || locked) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else if (!strict) el.pause();
  };

  const seek = (v: number) => {
    if (strict) return;
    const el = elRef.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, v), dur || 0);
    setCur(el.currentTime);
  };

  const changeVol = (v: number) => {
    setVol(v);
    setVolume(v);
  };

  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  return (
    <div>
      <div className="rounded-2xl bg-black/40 p-4 ring-1 ring-white/10">
        <audio
          key={src}
          ref={elRef}
          src={src}
          preload="metadata"
          onPlay={() => {
            setPlaying(true);
            setPlayed(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            if (strict) {
              setLocked(true);
              onEndedRef.current?.();
            }
          }}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            setDur(e.currentTarget.duration || 0);
            e.currentTarget.volume = getVolume() / 100;
          }}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            disabled={locked}
            aria-label={playing ? "Pause audio" : "Play audio"}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#19D36B] text-black shadow-[0_0_24px_rgba(25,211,107,0.35)] transition hover:brightness-110 disabled:opacity-40"
          >
            {playing ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 4.5v15l13-7.5-13-7.5z" />
              </svg>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white/80">{title}</p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-white/45">
              {fmtTime(cur)} / {dur > 0 ? fmtTime(dur) : "–:––"}
              {played && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">▶ played</span>}
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-white/50" title="Playback speed">
            <span className="text-[10px] font-bold uppercase">Speed</span>
            <select
              value={rate}
              disabled={strict}
              onChange={(e) => setRate(Number(e.target.value))}
              className="rounded-lg bg-white/5 px-1.5 py-1 font-mono text-[11px] text-white ring-1 ring-white/10 outline-none disabled:opacity-40"
            >
              <option value={0.75}>0.75×</option>
              <option value={1}>1×</option>
              <option value={1.25}>1.25×</option>
              <option value={1.5}>1.5×</option>
            </select>
          </label>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(dur, 0.1)}
          step={0.1}
          value={Math.min(cur, dur || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          disabled={strict}
          className="exam-range mt-3 w-full disabled:opacity-40"
        />
        <div className="mt-2 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            className="shrink-0 text-white/45">
            <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          </svg>
          <input
            type="range"
            min={0}
            max={100}
            value={vol}
            onChange={(e) => changeVol(Number(e.target.value))}
            aria-label="Volume"
            className="exam-range w-32"
          />
          <span className="font-mono text-[11px] tabular-nums text-white/45">{vol}%</span>
          <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <div className="h-full rounded-full bg-[#19D36B] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/30">
        {strict ? (
          <>In this timed section the recording plays <span className="font-semibold text-white/50">once only</span> — no pause, rewind or speed change.</>
        ) : (
          <>In the real test the recording plays <span className="font-semibold text-white/50">once only</span> —
          practice without replaying when you feel ready.</>
        )}
      </p>
      {instructions && (
        <div className="mt-3 rounded-xl bg-[#19D36B]/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-emerald-100/90 ring-1 ring-[#19D36B]/20">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#19D36B]/80">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap">{instructions}</p>
        </div>
      )}
    </div>
  );
}
