import { useEffect, useMemo, useState } from "react";
import { useQuery } from '@tanstack/react-query';
import AttemptReview from "@/components/exam/AttemptReview";
import { myAttempts, type AttemptSummary } from "@/lib/tests";
import { usePrograms } from '@/components/ExamTracks';
import MockAssessmentHistory from '@/components/assessment/MockAssessmentHistory';
import { belongsToProgram, programQueryKey, type ExamProgram } from '@/lib/programs';
import { useSessionStore } from '@/lib/session-store';

type Props = {
  /** Refresh signal — bump after each submitted exam so history stays fresh. */
  refreshKey?: number;
  onStats?: (stats: { attempts: number; completed: number; avgScore: number | null }) => void;
};

function statusBadge(status: AttemptSummary["status"]) {
  if (status === "completed")
    return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
  if (status === "grading") return "bg-amber-400/10 text-amber-200 ring-amber-400/30";
  return "bg-sky-400/10 text-sky-200 ring-sky-400/30";
}

function scoreText(a: AttemptSummary): string {
  if (a.totalScore != null) return `${a.totalScore} pts`;
  if (a.autoScore != null) return `${a.autoScore} pts (auto)`;
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
  const userId = useSessionStore((state) => state.profile?.id);
  const profileProgram = useSessionStore((state) => state.profile?.activeProgram);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [watchdogExpired, setWatchdogExpired] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setWatchdogExpired(true), 4500);
    return () => window.clearTimeout(timer);
  }, []);

  const program: ExamProgram =
    programs.data?.activeProgram ?? profileProgram ?? "MULTILEVEL";

  const history = useQuery({
    queryKey: [...programQueryKey('my-attempts', userId, program), refreshKey],
    queryFn: () => myAttempts(50, program),
  });

  const attempts = useMemo(
    () => history.data?.filter((attempt) => belongsToProgram(attempt.testType, program)) ?? [],
    [history.data, program],
  );
  const loading = !watchdogExpired && ((programs.isLoading && !programs.data) || history.isLoading);
  const error = history.error ? friendlyError(history.error) : null;
  const load = () => history.refetch();

  useEffect(() => {
    setExpandedId(null);
  }, [program]);

  useEffect(() => {
    const scored = attempts.filter((a) => a.totalScore != null);
    onStats?.({
      attempts: attempts.length,
      completed: attempts.filter((a) => a.status === 'completed').length,
      avgScore: scored.length ? scored.reduce((sum, a) => sum + (a.totalScore ?? 0), 0) / scored.length : null,
    });
  }, [attempts, onStats]);

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">{program === 'IELTS' ? 'IELTS' : 'Multilevel'} history</h1>
          <p className="mt-1 text-sm text-slate-400">Your past attempts in this exam track. Other track results remain saved.</p>
        </div>
        {!loading && (
          <button
            onClick={() => void load()}
            className="btn-ghost shrink-0 rounded-xl px-3 py-2 text-xs text-slate-200 border border-emerald-500/15"
          >
            Refresh
          </button>
        )}
      </div>

      <div className="mt-4"><MockAssessmentHistory key={program} program={program} refreshKey={refreshKey} /></div>
      <h2 className="mt-5 font-bold text-slate-100">Practice test attempts</h2><p className="mt-1 text-xs text-slate-400">Practice points are separate from full mock {program === 'IELTS' ? 'bands' : '/75 estimates'}.</p>

      {loading && (
        <div className="mt-4 space-y-3" aria-label="Loading history">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-emerald-500/15 bg-[#111827] animate-pulse p-5">
              <div className="h-4 w-2/3 rounded bg-slate-800" />
              <div className="mt-2 h-3 w-1/3 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-[#111827] p-5">
          <p className="text-sm font-medium text-red-300">Could not load history</p>
          <p className="mt-1 text-xs text-slate-400">{error}</p>
          <button
            onClick={() => void load()}
            className="btn-brand mt-3 rounded-xl px-4 py-2 text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && attempts && attempts.length === 0 && (
        <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-[#111827] p-6 text-center">
          <p className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xl">📝</p>
          <p className="mt-3 text-sm font-semibold text-slate-100">No attempts yet</p>
          <p className="mx-auto mt-1 max-w-60 text-xs text-slate-400">
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
            <li key={a.id} className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {a.testTitle ?? "Exam"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
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
                  className="btn-ghost mt-3 w-full rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white border border-emerald-500/15"
                >
                  {open ? "▾ Hide answer review" : "⌖ Review answers — locate & explain"}
                </button>
              )}
              {open && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <AttemptReview attemptId={a.id} showIeltsEstimate={program === 'IELTS'} />
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
