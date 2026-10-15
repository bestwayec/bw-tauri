import { useEffect } from "react";

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
}: Props) {
  if (!open) return null;

  const unanswered = Math.max(0, total - answered);
  const { shown, hidden } = summariseNumbers(unansweredNumbers);

  return (
    <div className="exam-help" role="dialog" aria-modal="true" aria-label="Submit section" onClick={onCancel}>
      <div className="exam-help-card" onClick={(e) => e.stopPropagation()}>
        <h2>Submit this section?</h2>
        <p className="exam-confirm-line">
          <strong>{answered}</strong> of <strong>{total}</strong> question{total === 1 ? "" : "s"} answered
          {unanswered > 0 ? ` · ${unanswered} still empty` : " · nothing left empty"}
          {flagged > 0 ? ` · ${flagged} flagged for review` : ""}
        </p>

        {unanswered > 0 && (
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
          <button type="button" onClick={onConfirm} disabled={submitting} className="exam-btn-primary">
            {submitting ? "Submitting…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
