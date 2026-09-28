import { useEffect, useMemo, useState } from "react";
import { rawToBand } from "@/lib/exam-types";
import { getAttemptReview, type AttemptReviewItem } from "@/lib/tests";

type Filter = "all" | "right" | "wrong" | "manual";

function friendlyError(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof message === "string" && message) {
      return typeof code === "string" && code ? `${message} (${code})` : message;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return "Request failed. Check connection.";
}

/** First accepted variant: "1987|nineteen eighty seven" → "1987". */
function firstVariant(correct: string | null | undefined): string | null {
  if (!correct) return null;
  const v = correct.split("|").map((s) => s.trim()).filter(Boolean)[0];
  return v || null;
}

/** ±160-char window around the correct answer inside the passage, if found. */
function locateSnippet(passage: string, correct: string | null): { before: string; hit: string | null; after: string } {
  if (!correct) return { before: passage.slice(0, 600), hit: null, after: "" };
  const idx = passage.toLowerCase().indexOf(correct.toLowerCase());
  if (idx < 0) return { before: passage.slice(0, 600), hit: null, after: passage.length > 600 ? "…" : "" };
  const start = Math.max(0, idx - 160);
  const end = Math.min(passage.length, idx + correct.length + 160);
  return {
    before: (start > 0 ? "…" : "") + passage.slice(start, idx),
    hit: passage.slice(idx, idx + correct.length),
    after: passage.slice(idx + correct.length, end) + (end < passage.length ? "…" : ""),
  };
}

function ItemBadge({ item }: { item: AttemptReviewItem }) {
  if (item.isCorrect === true)
    return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#19D36B] text-xs font-black text-black">✓</span>;
  if (item.isCorrect === false)
    return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-red-500/20 text-xs font-black text-red-300 ring-1 ring-red-500/40">✕</span>;
  return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-400/15 text-xs font-black text-amber-200 ring-1 ring-amber-400/30">…</span>;
}

/**
 * Shared Locate & Explain review: band estimate + per-question right/wrong
 * with correct answer and passage location. Used by Result + History.
 */
export default function AttemptReview({ attemptId }: { attemptId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AttemptReviewItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("all");
  const [section, setSection] = useState<string>("all");
  const [located, setLocated] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setError(null);
    getAttemptReview(attemptId).then(
      (res) => {
        if (dead) return;
        setItems(res.questions ?? []);
        setStatus(res.status);
        setLoading(false);
      },
      (e) => {
        if (dead) return;
        setError(friendlyError(e));
        setLoading(false);
      },
    );
    return () => {
      dead = true;
    };
  }, [attemptId]);

  const sections = useMemo(() => [...new Set(items.map((q) => q.section))], [items]);
  const auto = useMemo(() => items.filter((q) => q.isCorrect != null), [items]);
  const correct = auto.filter((q) => q.isCorrect).length;
  const band = auto.length > 0 ? rawToBand(correct, auto.length) : null;

  const visible = items.filter((q) => {
    if (section !== "all" && q.section !== section) return false;
    if (filter === "right") return q.isCorrect === true;
    if (filter === "wrong") return q.isCorrect === false;
    if (filter === "manual") return q.isCorrect == null;
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-2" aria-label="Loading review">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/10">
            <div className="h-3 w-2/3 rounded bg-white/10" />
            <div className="mt-2 h-3 w-1/3 rounded bg-white/5" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
        Could not load answer review: {error}
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-xs text-white/40">No per-question review available for this attempt.</p>;
  }

  return (
    <div>
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2">
        {band != null ? (
          <span className="rounded-lg bg-[#19D36B]/12 px-2.5 py-1 text-xs font-black text-[#19D36B] ring-1 ring-[#19D36B]/40">
            ≈ Band {band.toFixed(1)} · {correct}/{auto.length} auto-correct
          </span>
        ) : (
          <span className="rounded-lg bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-200 ring-1 ring-amber-400/30">
            {status === "grading" ? "Auto parts scored — writing/speaking pending" : "Manual grading pending"}
          </span>
        )}
        <span className="text-[11px] text-white/35">Band is an estimate from auto-marked parts only.</span>
      </div>

      {/* Filters */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["all", "right", "wrong", "manual"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ring-1 transition ${
              filter === f
                ? "bg-[#19D36B]/15 text-[#19D36B] ring-[#19D36B]/40"
                : "bg-white/[0.04] text-white/50 ring-white/10 hover:text-white"
            }`}
          >
            {f === "all" ? `All (${items.length})` : f === "right" ? `✓ Right (${correct})` : f === "wrong" ? `✕ Wrong (${auto.length - correct})` : `… Manual (${items.length - auto.length})`}
          </button>
        ))}
        {sections.length > 1 && (
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            aria-label="Filter by section"
            className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-white ring-1 ring-white/10 outline-none"
          >
            <option value="all">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>

      {/* Items */}
      <ol className="mt-3 space-y-2">
        {visible.map((q) => {
          const variant = firstVariant(q.correctAnswer);
          const mine = (q.answer ?? "").trim();
          const open = located === q.questionId;
          const snippet = q.passageText ? locateSnippet(q.passageText, variant) : null;
          return (
            <li key={q.questionId} className="rounded-xl bg-black/30 p-3.5 ring-1 ring-white/10">
              <div className="flex items-start gap-2.5">
                <ItemBadge item={q} />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                    Q{q.order} · {q.section}
                  </p>
                  <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-white/80">{q.prompt}</p>
                  <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
                    <p className={`rounded-lg px-2.5 py-1.5 ring-1 ${q.isCorrect === false ? "bg-red-500/10 text-red-200 ring-red-500/30" : "bg-white/[0.04] text-white/70 ring-white/10"}`}>
                      <span className="font-bold text-white/40">You: </span>{mine || <span className="italic text-white/30">no answer</span>}
                    </p>
                    {variant ? (
                      <p className="rounded-lg bg-[#19D36B]/10 px-2.5 py-1.5 text-[#9ff0c3] ring-1 ring-[#19D36B]/30">
                        <span className="font-bold text-[#19D36B]/70">Correct: </span>{variant}
                      </p>
                    ) : q.isCorrect == null ? (
                      <p className="rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-amber-200 ring-1 ring-amber-400/30">
                        Manual grading{q.comment ? ` — “${q.comment}”` : " pending"}
                      </p>
                    ) : null}
                  </div>
                  {(q.passageText || q.hasAudio) && (
                    <button
                      type="button"
                      onClick={() => setLocated(open ? null : q.questionId)}
                      aria-expanded={open}
                      className="mt-2 rounded-lg px-2 py-1 text-[11px] font-bold text-sky-300 hover:text-sky-200"
                    >
                      {open ? "▾ Hide location" : "⌖ Locate in material"}
                    </button>
                  )}
                  {open && snippet && (
                    <div className="mt-1.5 rounded-lg bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-white/60 ring-1 ring-white/10">
                      <p>{snippet.before}{snippet.hit && <mark className="rounded bg-[#19D36B]/30 px-0.5 text-emerald-50">{snippet.hit}</mark>}{snippet.after}</p>
                      {!snippet.hit && <p className="mt-1 text-[11px] text-white/30">Answer location not found verbatim — read the full passage above for context.</p>}
                    </div>
                  )}
                  {open && !snippet && q.hasAudio && (
                    <p className="mt-1.5 rounded-lg bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-white/50 ring-1 ring-white/10">
                      🎧 Listening answer — replay the part audio in the runner to hear it in context.
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {visible.length === 0 && (
        <p className="mt-3 text-xs text-white/40">Nothing matches this filter.</p>
      )}
    </div>
  );
}
