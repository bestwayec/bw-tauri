import { getExamTheme } from "@/lib/ui-prefs";

/**
 * Placeholder shown while an exam screen's code chunk or data loads, in the
 * same theme the runner will open with, so entering a section never shows a
 * blank white or black window.
 */
export default function RunnerSkeleton({ label = "Bo'lim yuklanmoqda…" }: { label?: string }) {
  const theme = getExamTheme();
  return (
    <div
      className="exam-shell"
      data-exam-theme={theme === "standard" ? "light" : theme}
      data-contrast-theme={theme}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="runner-skeleton"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--ex-line)] bg-[var(--ex-pane)] px-4">
        <div className="h-3 w-40 animate-pulse rounded bg-[var(--ex-line)]" />
        <div className="ml-auto h-3 w-20 animate-pulse rounded bg-[var(--ex-line)]" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-2">
        {[0, 1].map((pane) => (
          <div key={pane} className="flex flex-col gap-3 rounded-lg border border-[var(--ex-line)] bg-[var(--ex-pane)] p-4">
            {[90, 75, 82, 60, 70].map((w, i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-[var(--ex-line)]" style={{ width: `${w}%` }} />
            ))}
          </div>
        ))}
      </div>
      <p className="pb-4 text-center text-sm text-[var(--ex-muted)]">{label}</p>
    </div>
  );
}
