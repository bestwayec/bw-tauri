import { useEffect, useState } from "react";
import ElasticSlider from "@/components/ElasticSlider";
import { VOLUME_EVENT, getVolume, setVolume } from "@/lib/volume";

function SpeakerLow() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0 text-white/50">
      <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" opacity="0.9" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

function SpeakerHigh() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0 text-emerald-300">
      <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" opacity="0.9" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

type Props = {
  /** Card title shown above the slider. */
  label?: string;
  compact?: boolean;
};

/**
 * Listening-audio volume built on the React Bits ElasticSlider.
 * Writes to shared volume state so every `<audio>` on the page follows.
 */
export default function VolumeControl({ label = "Audio volume", compact = false }: Props) {
  // Stable seed — ElasticSlider resets when `defaultValue` changes,
  // so only change it (via `key`) on explicit mute toggles, never on drags.
  const [seed, setSeed] = useState(() => getVolume());
  const [muted, setMuted] = useState(() => getVolume() === 0);
  const [previous, setPrevious] = useState<number>(() => getVolume() || DEFAULT_FALLBACK);

  useEffect(() => {
    const onChange = (e: Event) => {
      const v = (e as CustomEvent<number>).detail;
      setMuted(v === 0);
    };
    window.addEventListener(VOLUME_EVENT, onChange);
    return () => window.removeEventListener(VOLUME_EVENT, onChange);
  }, []);

  function toggleMute() {
    if (muted) {
      setVolume(previous);
      setSeed(previous);
    } else {
      setPrevious(getVolume() || DEFAULT_FALLBACK);
      setVolume(0);
      setSeed(0);
    }
  }

  return (
    <div className={`card rounded-2xl ${compact ? "px-4 py-3" : "p-5"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{label}</p>
        <button
          type="button"
          onClick={toggleMute}
          className="btn-ghost rounded-lg px-3 py-1 text-xs text-white/70 hover:text-white"
          aria-pressed={muted}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
      <div className="mt-1 flex justify-center">
        <ElasticSlider
          key={seed}
          defaultValue={seed}
          startingValue={0}
          maxValue={100}
          isStepped
          stepSize={5}
          leftIcon={<SpeakerLow />}
          rightIcon={<SpeakerHigh />}
          onValueChange={(v) => setVolume(v)}
          ariaLabel="Audio volume"
        />
      </div>
      <p className="mt-1 text-center text-[11px] text-white/35">
        Applies to all listening audio in this app
      </p>
    </div>
  );
}

const DEFAULT_FALLBACK = 80;
