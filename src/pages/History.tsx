import { useCallback, useEffect, useState } from "react";
import AttemptReview from "@/components/exam/AttemptReview";
import { myAttempts, type AttemptSummary } from "@/lib/tests";
import { usePrograms } from '@/components/ExamTracks';
import MultilevelHistory from '@/components/MultilevelHistory';

type Props = {
  /** Refresh signal — bump after each submitted exam so history stays fresh. */
  refreshKey?: number;
  onStats?: (stats: { attempts: number; completed: number; avgScore: number | null }) => void;
};

function statusBadge(status: AttemptSummary["status"]) {
  if (status === "completed")
    return "bg-brand/10 text-brand-subtle-fg ring-brand/30";
  if (status === "grading") return "bg-amber-400/10 text-amber-200 ring-amber-400/30";
  return "bg-sky-400/10 text-sky-200 ring-sky-400/30";
}

function scoreText(a: AttemptSummary): string {
  if (a.totalScore != null) return String(a.totalScore);
  if (a.autoScore != null) return `${a.autoScore} (auto)`;
  if (a.status === "grading") return "grading…";
  return "—";
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Past attempts with scores — pulled from GET /tests/attempts/mine. */
export default function History({ refreshKey = 0, onStats }: Props) {
  const programs = usePrograms();
  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await myAttempts();
      setAttempts(items);
      const scored = items.filter((a) => a.totalScore != null);
      onStats?.({
        attempts: items.length,
        completed: items.filter((a) => a.status === "completed").length,
        avgScore: scored.length
          ? scored.reduce((s, a) => s + (a.totalScore ?? 0), 0) / scored.length
          : null,
      });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is a stable fetch closure; effect keyed on refreshKey only to avoid refetch loops
  }, [refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (programs.data?.activeProgram === 'MULTILEVEL') return <MultilevelHistory refreshKey={refreshKey} />;
  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-white/50">Your past attempts and scores.</p>
        </div>
        {!loading && (
          <button
            onClick={() => void load()}
            className="btn-ghost shrink-0 rounded-xl px-3 py-2 text-xs text-white"
          >
            Refresh
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 space-y-3" aria-label="Loading history">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card animate-pulse rounded-2xl p-5">
              <div className="h-4 w-2/3 rounded bg-white/10" />
              <div className="mt-2 h-3 w-1/3 rounded bg-white/5" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="card mt-4 rounded-2xl border border-red-500/30 p-5">
          <p className="text-sm font-medium text-red-300">Could not load history</p>
          <p className="mt-1 text-xs text-white/60">{error}</p>
          <button
            onClick={() => void load()}
            className="btn-brand mt-3 rounded-xl px-4 py-2 text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && attempts && attempts.length === 0 && (
        <div className="card mt-4 rounded-2xl p-6 text-center">
          <p className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-xl">📝</p>
          <p className="mt-3 text-sm font-semibold text-white">No attempts yet</p>
          <p className="mx-auto mt-1 max-w-60 text-xs text-white/40">
            Finished exams will appear here with their scores once graded.
          </p>
        </div>
      )}

      {!loading && !error && attempts && attempts.length > 0 && (
        <ul className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {attempts.map((a) => {
            const open = expandedId === a.id;
            const reviewable = a.status !== "in_progress";
            return (
            <li key={a.id} className="card rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {a.testTitle ?? "Exam"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-white/40">
                    {formatDate(a.finishedAt ?? a.startedAt)}
                    {a.testType && <span className="uppercase"> · {a.testType}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${statusBadge(a.status)}`}
                  >
                    {scoreText(a)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ${statusBadge(a.status)}`}
                  >
                    {a.status.replace("_", " ")}
                  </span>
                </div>
              </div>
              {reviewable && (
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : a.id)}
                  aria-expanded={open}
                  className="btn-ghost mt-3 w-full rounded-xl px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
                >
                  {open ? "▾ Hide answer review" : "⌖ Review answers — locate & explain"}
                </button>
              )}
              {open && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <AttemptReview attemptId={a.id} />
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

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
