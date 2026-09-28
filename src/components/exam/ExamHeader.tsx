import { useState } from "react";

export type ExamSectionName = string;

type Props = {
  testTitle: string;
  section: ExamSectionName;
  partIdx: number;
  partsLength: number;
  rangeLabel: string;
  progress: number;
  answered: number;
  total: number;
  remainingMs: number | null;
  timeUp: boolean;
  fontSize: number;
  onFontChange: (px: number) => void;
  helpText: string;
  onExit: () => void;
};

function fmtClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

function sectionBadge(section: string): string {
  const s = section.toLowerCase();
  if (s.includes("listen")) return "IELTS Listening";
  if (s.includes("read")) return "IELTS Reading";
  if (s.includes("writ")) return "IELTS Writing";
  if (s.includes("speak")) return "IELTS Speaking";
  return section.charAt(0).toUpperCase() + section.slice(1);
}

/**
 * Practice-platform header in Bestway dark theme.
 * Timer + progress + Hide / font-size / Help / Exit. No light-theme clone.
 */
export default function ExamHeader({
  testTitle,
  section,
  partIdx,
  partsLength,
  rangeLabel,
  progress,
  answered,
  total,
  remainingMs,
  timeUp,
  fontSize,
  onFontChange,
  helpText,
  onExit,
}: Props) {
  const [hidden, setHidden] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <>
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-[#101512]/90 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-lg bg-[#19D36B]/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#19D36B] ring-1 ring-[#19D36B]/30">
            {sectionBadge(section)}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-white">{testTitle}</p>
            <p className="text-[11px] text-[#8D9891]">
              {partsLength > 1
                ? `Part ${partIdx + 1}/${partsLength} · ${section} · ${rangeLabel}`
                : `${section} · ${rangeLabel}`}
            </p>
          </div>
        </div>

        <div className="mx-auto hidden w-full max-w-xs items-center gap-2 xl:flex" aria-hidden="true">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#19D36B] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-mono text-[11px] tabular-nums text-white/55">{progress}%</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {remainingMs != null && (
            <span
              role="timer"
              className={`rounded-lg px-2.5 py-1 font-mono text-xs font-bold tabular-nums ring-1 ${
                timeUp
                  ? "bg-red-500/15 text-red-300 ring-red-500/40"
                  : remainingMs < 5 * 60_000
                    ? "bg-amber-400/10 text-amber-200 ring-amber-400/30"
                    : "bg-white/5 text-white/70 ring-white/10"
              }`}
              title="Time remaining"
            >
              ⏱ {fmtClock(remainingMs)}
            </span>
          )}
          <span className="rounded-lg bg-white/5 px-2.5 py-1 font-mono text-xs tabular-nums text-white/70 ring-1 ring-white/10">
            {answered}/{total}
          </span>
          <button
            type="button"
            onClick={() => setHidden(true)}
            title="Hide screen (pause display)"
            className="btn-ghost hidden rounded-lg px-2.5 py-1 text-xs text-white/60 hover:text-white sm:inline"
          >
            🙈 Hide
          </button>
          <div className="hidden items-center gap-1 rounded-lg bg-white/5 px-1.5 py-1 ring-1 ring-white/10 md:flex" title="Reading font size">
            <button
              type="button"
              aria-label="Decrease font size"
              onClick={() => onFontChange(fontSize - 1)}
              className="rounded px-1.5 text-xs font-bold text-white/60 hover:text-white"
            >
              A−
            </button>
            <button
              type="button"
              aria-label="Increase font size"
              onClick={() => onFontChange(fontSize + 1)}
              className="rounded px-1.5 text-xs font-bold text-white/60 hover:text-white"
            >
              A+
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            title="How to answer this part"
            className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-white/60 hover:text-white"
          >
            ? Help
          </button>
          <button
            type="button"
            onClick={onExit}
            title="Leave exam (answers are saved)"
            className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-white/60 hover:text-white"
          >
            ✕ Exit
          </button>
        </div>
      </header>

      {hidden && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-6 backdrop-blur-sm">
          <div className="card w-full max-w-sm rounded-2xl p-8 text-center">
            <p className="text-3xl">🙈</p>
            <h2 className="mt-2 text-lg font-black text-white">Screen hidden</h2>
            <p className="mt-1 text-xs leading-relaxed text-white/50">
              The timer keeps running. Take your break, then resume when ready.
            </p>
            <button
              type="button"
              onClick={() => setHidden(false)}
              className="btn-brand mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-bold"
            >
              Resume test
            </button>
          </div>
        </div>
      )}

      {showHelp && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"
          onClick={() => setShowHelp(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Answer help"
        >
          <div
            className="card w-full max-w-md rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-bold text-white">How to answer</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-white/70">{helpText}</p>
            <p className="mt-3 text-[11px] leading-relaxed text-white/35">
              Flag any question for review with ⚑ — flagged slots turn round in the
              palette. Everything autosaves; the test submits itself when time expires.
            </p>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="btn-brand mt-4 w-full rounded-xl px-4 py-2 text-sm font-bold"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
