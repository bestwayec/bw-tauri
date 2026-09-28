type Props = {
  open: boolean;
  answered: number;
  total: number;
  flaggedNums: number[];
  unansweredNums: number[];
  submitting: boolean;
  onJump: (num: number) => void;
  onClose: () => void;
  onSubmit: () => void;
};

/** Pre-submit review: answered / flagged / unanswered summary with jump-back. */
export default function ReviewModal({
  open,
  answered,
  total,
  flaggedNums,
  unansweredNums,
  submitting,
  onJump,
  onClose,
  onSubmit,
}: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Review before submit"
    >
      <div
        className="card max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-black text-white">Review before submit</h2>
        <p className="mt-1 text-xs text-white/50">
          {answered}/{total} answered · {flaggedNums.length} flagged · {unansweredNums.length} unanswered (count as 0)
        </p>

        {flaggedNums.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200">⚑ Flagged</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {flaggedNums.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    onJump(n);
                    onClose();
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full bg-amber-400/15 font-mono text-xs font-bold text-amber-200 ring-1 ring-amber-400/50 hover:bg-amber-400/25"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {unansweredNums.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/45">
              Unanswered ({unansweredNums.length})
            </p>
            <div className="mt-1.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {unansweredNums.slice(0, 60).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    onJump(n);
                    onClose();
                  }}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.05] font-mono text-xs font-bold text-white/55 ring-1 ring-white/10 hover:text-white"
                >
                  {n}
                </button>
              ))}
              {unansweredNums.length > 60 && (
                <span className="px-2 py-1 text-[11px] text-white/35">+{unansweredNums.length - 60} more</span>
              )}
            </div>
          </div>
        )}

        {flaggedNums.length === 0 && unansweredNums.length === 0 && (
          <p className="mt-4 rounded-xl bg-[#19D36B]/10 px-3 py-2.5 text-xs font-semibold text-[#19D36B] ring-1 ring-[#19D36B]/30">
            ✓ Everything is answered and nothing is flagged. Ready to submit.
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost rounded-xl px-4 py-2.5 text-sm text-white"
          >
            Keep working
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="rounded-xl bg-[#19D36B] px-4 py-2.5 text-sm font-black text-black shadow-[0_0_20px_rgba(25,211,107,0.3)] transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : `Submit ${answered}/${total}`}
          </button>
        </div>
      </div>
    </div>
  );
}
