import { questionState, type QState } from "./model";

export interface PartTab {
  label: string;
  answered: number;
  total: number;
}

type Props = {
  parts: PartTab[];
  currentPart: number;
  onPart: (i: number) => void;
  /** Per-question answered flags (global numbering). */
  answered: boolean[];
  /** Per-question flagged-for-review flags. */
  flagged: boolean[];
  currentQ: number;
  onJumpQ: (globalIndex: number) => void;
  onToggleFlag: (globalIndex: number) => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  /** Last part: submit button replaces Next. */
  isLastPart: boolean;
  submitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
};

const STATE_CLASS: Record<QState, string> = {
  current: "exam-qbtn-current",
  answered: "exam-qbtn-answered",
  flagged: "exam-qbtn-flagged",
  unanswered: "exam-qbtn-todo",
};

/**
 * Fixed bottom bar: part tabs with answered/total, every question as a
 * stateful jump button, flag toggle, Prev/Next (or Submit on the last part).
 */
export default function BottomNav(p: Props) {
  return (
    <footer className="exam-bottomnav">
      <div className="exam-parts" role="tablist" aria-label="Parts">
        {p.parts.map((t, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === p.currentPart}
            onClick={() => p.onPart(i)}
            className={`exam-part${i === p.currentPart ? " exam-part-active" : ""}`}
          >
            {t.label}
            <span className="exam-part-count tabular-nums">
              {t.answered}/{t.total}
            </span>
          </button>
        ))}
      </div>

      <div className="exam-qs" role="group" aria-label="Questions">
        {p.answered.map((a, i) => {
          const st = questionState(i, p.currentQ, a, p.flagged[i] ?? false);
          return (
            <button
              key={i}
              type="button"
              onClick={() => p.onJumpQ(i)}
              aria-label={`Question ${i + 1}${st === "answered" ? ", answered" : st === "flagged" ? ", flagged for review" : ", unanswered"}${i === p.currentQ ? ", current" : ""}`}
              className={`exam-qbtn ${STATE_CLASS[st]}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      <div className="exam-navbtns">
        <button
          type="button"
          onClick={() => p.onToggleFlag(p.currentQ)}
          aria-pressed={p.flagged[p.currentQ] ?? false}
          title="Flag for review"
          className="exam-btn-ghost"
        >
          {(p.flagged[p.currentQ] ?? false) ? "⚑ Flagged" : "⚐ Flag"}
        </button>
        <button type="button" onClick={p.onPrev} disabled={!p.canPrev} className="exam-btn-ghost">
          ← Prev
        </button>
        {p.isLastPart ? (
          <button
            type="button"
            onClick={p.onSubmit}
            disabled={p.submitting}
            className="exam-btn-primary"
          >
            {p.submitting ? "Submitting…" : p.submitLabel}
          </button>
        ) : (
          <button type="button" onClick={p.onNext} className="exam-btn-primary">
            Next →
          </button>
        )}
      </div>
    </footer>
  );
}
