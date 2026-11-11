import { fmtCountdown, type ContrastTheme, type SimulatorMode } from "./model";

export type SaveState = "checking" | "saved" | "saving" | "offline" | "error";

type Props = {
  candidateName: string | null;
  sectionTitle: string;
  partLabel: string;
  skill?: string;
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
  onRetrySave?: () => void;
  onHelp: () => void;
  onExit: () => void;
  onSubmit?: () => void;
  partsNav?: { parts: Array<{ label: string; active: boolean }>; onSelect: (idx: number) => void } | null;
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
          {p.skill && (() => {
            const s = p.skill.toLowerCase();
            const badgeClass = s.includes("listen")
              ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
              : s.includes("read")
                ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                : s.includes("writ")
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : s.includes("speak")
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
            return (
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border ${badgeClass}`}>
                {p.skill}
              </span>
            );
          })()}
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
        {p.partsNav && p.partsNav.parts.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--ex-line)] p-0.5 ml-2">
            {p.partsNav.parts.map((prt, idx) => (
              <button
                key={prt.label}
                type="button"
                onClick={() => p.partsNav!.onSelect(idx)}
                className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
                  prt.active ? "bg-emerald-600 text-white" : "opacity-60 hover:opacity-100"
                }`}
              >
                {prt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="exam-topbar-mid">
        <span
          className={`exam-timer${urgent ? " exam-timer-urgent animate-pulse text-amber-400 font-black" : ""}`}
          role="timer"
          aria-label="Time remaining"
        >
          {p.remainingMs == null ? "Practice · no time limit" : p.timeUp ? "Time up" : fmtCountdown(p.remainingMs)}
        </span>
        <span
          className={`exam-savestate exam-savestate-${p.saveState}`}
          role="status"
          aria-live="polite"
        >
          {p.saveState === "checking"
            ? "Checking saved answers…"
            : p.saveState === "saved"
            ? "Saved"
            : p.saveState === "saving"
              ? "Saving…"
              : p.saveState === "offline"
                ? "Offline — answers not yet saved to server"
                : "Save failed — answers not yet saved to server"}
        </span>
        {(p.saveState === "offline" || p.saveState === "error") && p.onRetrySave && (
          <button type="button" className="exam-btn-ghost" onClick={p.onRetrySave}>Retry saving</button>
        )}
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
        <div className="flex items-center gap-1.5">
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--ex-line)] p-0.5" role="group" aria-label="Font size presets">
            <button
              type="button"
              onClick={() => p.onFontSize(14)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${p.fontSize <= 15 ? "bg-emerald-600 text-white" : "opacity-70 hover:opacity-100"}`}
              title="Small font (14px)"
            >
              Small
            </button>
            <button
              type="button"
              onClick={() => p.onFontSize(17)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${p.fontSize > 15 && p.fontSize < 19 ? "bg-emerald-600 text-white" : "opacity-70 hover:opacity-100"}`}
              title="Medium font (17px)"
            >
              Medium
            </button>
            <button
              type="button"
              onClick={() => p.onFontSize(20)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${p.fontSize >= 19 ? "bg-emerald-600 text-white" : "opacity-70 hover:opacity-100"}`}
              title="Large font (20px)"
            >
              Large
            </button>
          </div>
          <label className="exam-control hidden lg:flex" title="Text size">
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
        </div>
        <div
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--ex-line)] p-0.5"
          role="group"
          aria-label="Contrast theme"
        >
          {(
            [
              { id: "app", label: "Dark", title: "Bestway dark theme (matches the app)" },
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
        {p.onSubmit && (
          <button
            type="button"
            onClick={p.onSubmit}
            className="rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-black px-3.5 py-1.5 text-xs shadow-md shadow-emerald-500/25 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
            title="Review questions and submit exam"
          >
            <span className="w-2 h-2 rounded-full bg-slate-950" />
            Review &amp; Submit
          </button>
        )}
        <button type="button" onClick={p.onExit} className="exam-btn-ghost" title="Leave exam">
          Leave
        </button>
      </div>
    </header>
  );
}
