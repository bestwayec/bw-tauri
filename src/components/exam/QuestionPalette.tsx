type Props = {
  total: number;
  answers: Record<string, string>;
  questionIds: string[];
  flags: Record<string, boolean>;
  currentNum: number;
  onJump: (num: number) => void;
  collapsed: boolean;
  onToggle: () => void;
};

/**
 * Numbered question palette. Bestway dark styling, official-exam states:
 * current = solid brand square, answered = brand tint square,
 * flagged-for-review = round (circle) amber ring, todo = dim square.
 */
export default function QuestionPalette({
  total,
  answers,
  questionIds,
  flags,
  currentNum,
  onJump,
  collapsed,
  onToggle,
}: Props) {
  const answeredCount = questionIds.filter((id) => (answers[id] ?? "").trim()).length;
  const flaggedCount = questionIds.filter((id) => flags[id]).length;

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#101512]/95">
      <div className="flex items-center gap-2 px-4 pt-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="rounded-lg px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white/45 hover:text-white"
        >
          {collapsed ? `▸ Questions ${answeredCount}/${total}` : "▾ Questions"}
        </button>
        {!collapsed && (
          <span className="flex items-center gap-3 text-[10px] text-white/35">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded bg-[#19D36B]/25 ring-1 ring-[#19D36B]/40" /> answered
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400/20 ring-1 ring-amber-400/50" /> flagged
            </span>
            <span className="hidden sm:inline">· {flaggedCount} flagged</span>
          </span>
        )}
      </div>
      {!collapsed && (
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-4 pb-2 pt-1"
          role="navigation"
          aria-label="Questions"
        >
          {questionIds.map((id, i) => {
            const n = i + 1;
            const done = (answers[id] ?? "").trim().length > 0;
            const flagged = Boolean(flags[id]);
            const cur = n === currentNum;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onJump(n)}
                title={`Question ${n}${done ? " (answered)" : ""}${flagged ? " (flagged)" : ""}`}
                aria-label={`Question ${n}${done ? ", answered" : ""}${flagged ? ", flagged" : ""}`}
                aria-current={cur ? "true" : undefined}
                className={`grid h-7 w-7 shrink-0 place-items-center font-mono text-[11px] font-bold ring-1 transition ${
                  flagged ? "rounded-full" : "rounded-lg"
                } ${
                  cur
                    ? "bg-[#19D36B] text-black ring-[#19D36B]"
                    : flagged
                      ? "bg-amber-400/15 text-amber-200 ring-amber-400/50 hover:bg-amber-400/25"
                      : done
                        ? "bg-[#19D36B]/15 text-[#19D36B] ring-[#19D36B]/40 hover:bg-[#19D36B]/25"
                        : "bg-white/[0.05] text-white/45 ring-white/10 hover:text-white"
                }`}
              >
                {done && !cur && !flagged ? "✓" : flagged && !cur ? "⚑" : n}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
