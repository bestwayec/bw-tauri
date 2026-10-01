import { fmtCountdown } from "./model";

export type SaveState = "saved" | "saving" | "offline";

type Props = {
  candidateName: string | null;
  sectionTitle: string;
  partLabel: string;
  /** Milliseconds left (server-corrected), or null when untimed. */
  remainingMs: number | null;
  timeUp: boolean;
  volumeVisible: boolean;
  volume: number;
  onVolume: (v: number) => void;
  fontSize: number;
  onFontSize: (px: number) => void;
  dark: boolean;
  onToggleDark: () => void;
  saveState: SaveState;
  onHelp: () => void;
  onExit: () => void;
  back?: { label: string; onClick: () => void } | null;
};

/**
 * Thin IELTS-style top bar: candidate left, countdown center-right, controls.
 * No glow, no animation — quiet by design.
 */
export default function TopBar(p: Props) {
  const urgent = p.remainingMs != null && p.remainingMs < 5 * 60_000;
  return (
    <header className="exam-topbar">
      {p.back && (
        <button type="button" onClick={p.back.onClick} className="exam-btn-ghost" title={p.back.label}>
          ← {p.back.label}
        </button>
      )}
      <div className="exam-topbar-id">
        <span className="exam-topbar-name">{p.candidateName ?? "Candidate"}</span>
        <span className="exam-topbar-section">
          {p.sectionTitle} · {p.partLabel}
        </span>
      </div>

      <div className="exam-topbar-mid">
        <span
          className={`exam-timer${urgent ? " exam-timer-urgent" : ""}`}
          role="timer"
          aria-label="Time remaining"
        >
          {p.remainingMs == null ? "No limit" : p.timeUp ? "Time up" : fmtCountdown(p.remainingMs)}
        </span>
        <span className={`exam-savestate exam-savestate-${p.saveState}`} role="status">
          {p.saveState === "saved" ? "Saved" : p.saveState === "saving" ? "Saving…" : "Offline"}
        </span>
      </div>

      <div className="exam-topbar-controls">
        {p.volumeVisible && (
          <label className="exam-control" title="Volume">
            <span aria-hidden="true">🔊</span>
            <input
              type="range"
              min={0}
              max={100}
              value={p.volume}
              onChange={(e) => p.onVolume(Number(e.target.value))}
              aria-label="Volume"
              className="exam-range-sm"
            />
          </label>
        )}
        <label className="exam-control" title="Text size">
          <span aria-hidden="true" className="exam-aa">A</span>
          <input
            type="range"
            min={14}
            max={20}
            step={1}
            value={p.fontSize}
            onChange={(e) => p.onFontSize(Number(e.target.value))}
            aria-label="Text size"
            className="exam-range-sm"
          />
        </label>
        <button
          type="button"
          onClick={p.onToggleDark}
          aria-pressed={p.dark}
          title={p.dark ? "Light theme" : "Dark theme"}
          className="exam-btn-ghost"
        >
          {p.dark ? "☀" : "◐"}
        </button>
        <button type="button" onClick={p.onHelp} className="exam-btn-ghost" title="Exam help" aria-label="Exam help">
          ?
        </button>
        <button type="button" onClick={p.onExit} className="exam-btn-ghost" title="Exit exam">
          Exit
        </button>
      </div>
    </header>
  );
}
