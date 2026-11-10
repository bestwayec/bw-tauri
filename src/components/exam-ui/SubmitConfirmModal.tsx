import { useEffect } from "react";

export interface QuestionMatrixItem {
  number: number;
  globalIndex: number;
  answered: boolean;
  flagged: boolean;
}

type Props = {
  open: boolean;
  answered: number;
  total: number;
  flagged: number;
  /** Question numbers (global, 1-based) with no answer yet — capped for display. */
  unansweredNumbers: number[];
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  questions?: QuestionMatrixItem[];
  onJumpToQuestion?: (questionNumber: number, globalIndex: number) => void;
};

/** First `max` numbers of a list, plus how many were hidden. */
export function summariseNumbers(numbers: number[], max = 12): { shown: number[]; hidden: number } {
  return { shown: numbers.slice(0, max), hidden: Math.max(0, numbers.length - max) };
}

/**
 * Pre-submission check: how many questions are answered, how many are still
 * empty, and how many are flagged for review. Drafts are flushed to the server
 * before the submit call, so confirming here can only lose an *empty* question.
 */
export default function SubmitConfirmModal({ open, submitting, onCancel, ...rest }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, submitting, onCancel]);

  if (!open) return null;
  return <SubmitConfirmBody open submitting={submitting} onCancel={onCancel} {...rest} />;
}

/** Hook-free confirmation markup (Escape handling lives in the wrapper above). */
export function SubmitConfirmBody({
  open,
  answered,
  total,
  flagged,
  unansweredNumbers,
  submitting,
  submitLabel,
  onCancel,
  onConfirm,
  questions,
  onJumpToQuestion,
}: Props) {
  if (!open) return null;

  const hasQuestions = total > 0;
  const unanswered = Math.max(0, total - answered);
  const { shown, hidden } = summariseNumbers(unansweredNumbers);

  const matrixItems: QuestionMatrixItem[] =
    questions ??
    Array.from({ length: total }, (_, i) => {
      const num = i + 1;
      const isUnanswered = unansweredNumbers.includes(num);
      return {
        number: num,
        globalIndex: i,
        answered: !isUnanswered,
        flagged: false,
      };
    });

  return (
    <div className="exam-help" role="dialog" aria-modal="true" aria-label="Submit section" onClick={onCancel}>
      <div className="exam-help-card max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
          <h2 className="text-lg font-bold text-white">Submit this section?</h2>
          {hasQuestions && (
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              {answered} / {total} javob berildi
            </span>
          )}
        </div>

        {!hasQuestions ? (
          <div className="exam-confirm-warn">
            <p className="exam-confirm-warn-head">No questions loaded</p>
            <p className="exam-confirm-warn-note">
              No questions found for this section (0 / 0). Submission is disabled. Please reload or contact your teacher.
            </p>
          </div>
        ) : (
          <p className="exam-confirm-line text-sm text-white/80">
            <strong>{answered}</strong> of <strong>{total}</strong> question{total === 1 ? "" : "s"} answered
            {unanswered > 0 ? ` · ${unanswered} still empty` : " · nothing left empty"}
            {flagged > 0 ? ` · ${flagged} flagged for review` : ""}
          </p>
        )}

        {/* CDI Interactive Question Matrix */}
        {hasQuestions && matrixItems.length > 0 && (
          <div className="my-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs text-white/70">
              <span className="font-semibold text-white/90">CDI Question Review Matrix (savolga o'tish uchun bosing):</span>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-emerald-600 border border-emerald-500 inline-block" />
                  Answered
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-amber-500/10 border border-amber-500/80 inline-block" />
                  Unanswered
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-blue-600 border border-blue-400 inline-block" />
                  Flagged
                </span>
              </div>
            </div>

            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5 max-h-48 overflow-y-auto p-2.5 rounded-xl bg-black/40 border border-white/10">
              {matrixItems.map((item) => {
                let badgeClass = "border border-amber-500/80 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20";
                if (item.flagged) {
                  badgeClass = "bg-blue-600 text-white border border-blue-400 shadow-sm shadow-blue-500/30 hover:bg-blue-500";
                } else if (item.answered) {
                  badgeClass = "bg-emerald-600 text-white border border-emerald-500 shadow-sm shadow-emerald-500/30 hover:bg-emerald-500";
                }

                if (onJumpToQuestion) {
                  return (
                    <button
                      key={item.number}
                      type="button"
                      onClick={() => {
                        onJumpToQuestion(item.number, item.globalIndex);
                        onCancel();
                      }}
                      className={`h-8 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center cursor-pointer active:scale-95 ${badgeClass}`}
                      title={`Question ${item.number} (${item.flagged ? "Flagged" : item.answered ? "Answered" : "Unanswered"}) — Click to jump`}
                    >
                      {item.flagged ? `⚑ ${item.number}` : item.number}
                    </button>
                  );
                }

                return (
                  <span
                    key={item.number}
                    className={`h-8 rounded-lg font-mono text-xs font-bold flex items-center justify-center ${badgeClass}`}
                  >
                    {item.flagged ? `⚑ ${item.number}` : item.number}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {hasQuestions && unanswered > 0 && (
          <div className="exam-confirm-warn">
            <p className="exam-confirm-warn-head">Unanswered questions</p>
            <p className="exam-confirm-warn-nums">
              {shown.map((n) => `Q${n}`).join(", ")}
              {hidden > 0 ? ` +${hidden} more` : ""}
            </p>
            <p className="exam-confirm-warn-note">
              You can go back and answer them — or submit as they are. Empty answers score zero.
            </p>
          </div>
        )}

        <p className="exam-confirm-note">
          Your saved answers are uploaded first, then this section is sent for grading. You cannot change answers
          afterwards.
        </p>

        <div className="exam-confirm-actions">
          <button type="button" onClick={onCancel} disabled={submitting} className="exam-btn-ghost">
            Keep working
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || !hasQuestions}
            className="exam-btn-primary"
          >
            {submitting ? "Submitting…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
