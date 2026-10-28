import { useEffect, useRef, useState } from "react";

export const DEFAULT_WAVEFORM_BARS = 24;

/** Bar heights (0..1) derived from time-domain samples — pure + unit-tested. */
export function waveformLevels(samples: Uint8Array, bars: number): number[] {
  const count = Math.max(1, Math.floor(bars));
  const levels = new Array<number>(count).fill(0);
  if (samples.length === 0) return levels;
  const chunk = samples.length / count;
  for (let bar = 0; bar < count; bar++) {
    const from = Math.floor(bar * chunk);
    const to = Math.max(from + 1, Math.floor((bar + 1) * chunk));
    let sum = 0;
    let n = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      const centred = (samples[i] - 128) / 128;
      sum += centred * centred;
      n += 1;
    }
    levels[bar] = n === 0 ? 0 : Math.min(1, Math.sqrt(sum / n) * 4);
  }
  return levels;
}

/** Height used for a silent bar so the row is visible before anyone speaks. */
const IDLE_BAR = 0.12;

function idleLevels(bars: number): number[] {
  return new Array<number>(Math.max(1, Math.floor(bars))).fill(0);
}

function fmtElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Props = {
  /** Live microphone stream, or null when nothing is recording. */
  stream: MediaStream | null;
  /** True while a take is being captured — only then is audio analysed. */
  active: boolean;
  bars?: number;
  label?: string;
  /** Optional elapsed seconds shown next to the label. */
  elapsedSeconds?: number;
};

/**
 * Live microphone waveform for the speaking recorders: bar heights follow the
 * input level so the student can see that the microphone is actually picking
 * them up (and confirm the input is not clipped or dead).
 *
 * SSR-safe: with no stream, or when `AudioContext` is unavailable (node tests,
 * locked-down WebViews), it renders an inert bar row — it never throws and
 * never touches audio outside `useEffect`.
 */
export default function Waveform({
  stream,
  active,
  bars = DEFAULT_WAVEFORM_BARS,
  label,
  elapsedSeconds,
}: Props) {
  const [levels, setLevels] = useState<number[]>(() => idleLevels(bars));
  const frame = useRef<number | null>(null);
  const context = useRef<AudioContext | null>(null);

  useEffect(() => {
    setLevels(idleLevels(bars));
    if (!active || !stream) return;

    let disposed = false;
    const stop = () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
      const ctx = context.current;
      context.current = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    };

    try {
      const Ctor =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
      if (!Ctor) return stop;
      const ctx = new Ctor();
      context.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (disposed) return;
        analyser.getByteTimeDomainData(samples);
        setLevels(waveformLevels(samples, bars));
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch {
      /* visualisation is best-effort — recording continues without it */
    }

    return () => {
      disposed = true;
      stop();
    };
  }, [active, stream, bars]);

  const shown = levels.length === Math.max(1, Math.floor(bars)) ? levels : idleLevels(bars);

  return (
    <div className="flex items-center gap-2">
      <div
        role="img"
        aria-label={label ? `${label} waveform${active ? " recording" : ""}` : "Microphone waveform"}
        className="flex h-6 min-w-0 flex-1 items-end gap-[2px]"
        data-active={active ? "true" : "false"}
      >
        {shown.map((value, index) => (
          <span
            key={index}
            className={active ? "flex-1 rounded-sm bg-[#10B981]" : "flex-1 rounded-sm bg-current opacity-30"}
            style={{ height: `${Math.round(Math.max(IDLE_BAR, value) * 100)}%` }}
          />
        ))}
      </div>
      {typeof elapsedSeconds === "number" && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-70">
          ⏱ {fmtElapsed(elapsedSeconds)}
        </span>
      )}
    </div>
  );
}
