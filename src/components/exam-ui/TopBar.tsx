import { fmtCountdown, type ContrastTheme, type SimulatorMode } from "./model";

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
  contrastTheme?: ContrastTheme;
  onContrastThemeChange?: (theme: ContrastTheme) => void;
  simulatorMode?: SimulatorMode;
  onSimulatorModeChange?: (mode: SimulatorMode) => void;
  noteOpen?: boolean;
  onToggleNote?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  saveState: SaveState;
  onHelp: () => void;
  onExit: () => void;
  back?: { label: string; onClick: () => void } | null;
};

/**
 * Thin IELTS-style top bar: candidate left, countdown center-right, controls.
 * Supports CDI 3-contrast themes (standard, dark, grey), DTM full-screen toggle,
 * and Margin Notes drawer toggle.
 */
export default function TopBar(p: Props) {
  const urgent = p.remainingMs != null && p.remainingMs < 5 * 60_000;
  const activeTheme: ContrastTheme = p.contrastTheme ?? (p.dark ? "dark" : "standard");

  function handleSelectTheme(theme: ContrastTheme) {
    if (p.onContrastThemeChange) {
      p.onContrastThemeChange(theme);
    } else if ((theme === "dark") !== p.dark) {
      p.onToggleDark();
    }
  }

  function handleFullscreen() {
    if (p.onToggleFullscreen) {
      p.onToggleFullscreen();
      return;
    }
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  }

  return (
    <header className="exam-topbar">
      {p.back && (
        <button type="button" onClick={p.back.onClick} className="exam-btn-ghost" title={p.back.label}>
          ← {p.back.label}
        </button>
      )}
      <div className="exam-topbar-id">
        <div className="flex items-center gap-2">
          <span className="exam-topbar-name">{p.candidateName ?? "Candidate"}</span>
          {p.simulatorMode && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
              style={{
                background: p.simulatorMode === "dtm" ? "rgba(16,185,129,0.18)" : "rgba(59,130,246,0.18)",
                color: p.simulatorMode === "dtm" ? "#10b981" : "#3b82f6",
              }}
            >
              {p.simulatorMode === "dtm" ? "DTM Mode" : "CDI Mode"}
            </span>
          )}
        </div>
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
        <span
          className={`exam-savestate exam-savestate-${p.saveState}`}
          role="status"
          title={p.saveState === "offline" ? "Offline — javoblar lokal saqlanmoqda" : undefined}
        >
          {p.saveState === "saved"
            ? "Saved"
            : p.saveState === "saving"
              ? "Saving…"
              : "Offline — javoblar lokal saqlanmoqda"}
        </span>
      </div>

      <div className="exam-topbar-controls">
        {p.onSimulatorModeChange && p.simulatorMode && (
          <div className="inline-flex items-center rounded-lg border border-[var(--ex-line)] p-0.5" role="group" aria-label="Simulator mode">
            {(["cdi", "dtm"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => p.onSimulatorModeChange?.(m)}
                aria-pressed={p.simulatorMode === m}
                className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase ${
                  p.simulatorMode === m ? "bg-emerald-600 text-white" : " opacity-70 hover:opacity-100"
                }`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        )}
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
        <div
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--ex-line)] p-0.5"
          role="group"
          aria-label="Contrast theme"
        >
          {(
            [
              { id: "standard", label: "Standard", title: "Standard light contrast" },
              { id: "dark", label: "High Contrast", title: "High-contrast black (#09090b) with yellow/white text" },
              { id: "grey", label: "Grey", title: "Soft grey contrast (#2d3139)" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelectTheme(t.id)}
              aria-pressed={activeTheme === t.id}
              title={t.title}
              data-contrast-option={t.id}
              className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                activeTheme === t.id
                  ? "bg-emerald-600 text-white"
                  : "opacity-75 hover:opacity-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {p.onToggleNote && (
          <button
            type="button"
            onClick={p.onToggleNote}
            aria-pressed={p.noteOpen ?? false}
            title="Margin notes & highlights"
            className="exam-btn-ghost"
          >
            📝 Notes
          </button>
        )}
        <button
          type="button"
          onClick={handleFullscreen}
          aria-label="Toggle full screen"
          title="Toggle full screen"
          className="exam-btn-ghost"
        >
          {p.isFullscreen ? "⊡ Exit Fullscreen" : "⛶ Fullscreen"}
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
