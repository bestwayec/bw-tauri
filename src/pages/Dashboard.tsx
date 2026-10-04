import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Route } from "@/App";
import {
  listTests,
  myAttempts,
  startTest,
  type AttemptSummary,
  type StartResult,
  type TestListItem,
} from "@/lib/tests";
import { listMockExams } from "@/lib/mocks";
import { ExamTracks, usePrograms } from '@/components/ExamTracks';
import MultilevelHistory from '@/components/MultilevelHistory';

type Props = {
  studentName: string | null;
  onNavigate: (route: Route) => void;
  onStart: (test: TestListItem, start: StartResult) => void;
};

function greeting(name: string | null): string {
  const hour = new Date().getHours();
  const part =
    hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}${name ? `, ${name.split(" ")[0]}` : ""}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Desktop overview: stats, in-progress resume, recent activity, quick actions. */
const OVERVIEW_QUERY_OPTS = {
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  retry: 3,
  retryDelay: (attempt: number) => Math.min(1_000 * 2 ** attempt, 15_000),
} as const;

export default function Dashboard({ studentName, onNavigate, onStart }: Props) {
  const programs = usePrograms();
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const [testsQuery, attemptsQuery, mocksQuery] = useQueries({
    queries: [
      { queryKey: ["tests"], queryFn: () => listTests(), ...OVERVIEW_QUERY_OPTS },
      { queryKey: ["my-attempts"], queryFn: () => myAttempts(), ...OVERVIEW_QUERY_OPTS },
      { queryKey: ["mock-exams"], queryFn: listMockExams, ...OVERVIEW_QUERY_OPTS },
    ],
  });

  const loading = testsQuery.isPending || attemptsQuery.isPending || mocksQuery.isPending;
  const error =
    testsQuery.isError || attemptsQuery.isError || mocksQuery.isError
      ? "Could not load overview. Retrying automatically…"
      : null;

  // Include live mock count in assigned so new mocks appear without manual refresh.
  // 0-question rows are junk (never startable) — hide them like Exams does.
  const matchesTrack = (type: string) => programs.data?.activeProgram === 'MULTILEVEL' ? type === 'multilevel' : type !== 'multilevel';
  const tVisible = (testsQuery.data ?? []).filter((x) => x.questionCount > 0 && matchesTrack(x.type));
  const publishedMocks = (mocksQuery.data ?? []).filter((x) => (x.isPublished || x.isDemo) && x.questionCount > 0 && matchesTrack(x.type));
  // Merge for display purposes: tests are primary, mocks are additive for stats.
  // Mock-origin rows carry _isMock so resume never sends them to /tests/start.
  const tests: TestListItem[] = [
    ...tVisible,
    ...publishedMocks.map(
      (mm) =>
        ({
          id: mm.id,
          type: mm.type === "multilevel" ? "multilevel" : "ielts",
          title: mm.title,
          level: mm.level,
          isDemo: mm.isDemo,
          isActive: mm.isPublished,
          durationMinutes: mm.durationMinutes,
          questionCount: mm.questionCount,
          sections: mm.skills as unknown as TestListItem["sections"],
          _isMock: true,
        }) as unknown as TestListItem,
    ),
  ];
  const attempts: AttemptSummary[] | null = attemptsQuery.data ?? null;

  async function handleResume(a: AttemptSummary) {
    const test = tests.find((t) => t.id === a.testId);
    if (!test) return;
    // Mock attempts are not resumable via test endpoint – they use mock flow on web
    if ((test as unknown as { _isMock?: boolean })._isMock) return;
    setResumingId(a.id);
    setResumeError(null);
    try {
      const start = await startTest(test.id);
      onStart(test, start);
    } catch {
      setResumeError("Could not resume the attempt. Try again from Exams.");
    } finally {
      setResumingId(null);
    }
  }

  const assigned = tests.length;
  const ready = tests.filter((t) => t.questionCount > 0).length;
  const inProgress = attempts?.filter((a) => a.status === "in_progress") ?? [];
  const completed = attempts?.filter((a) => a.status === "completed").length ?? 0;
  const scored = attempts?.filter((a) => a.totalScore != null) ?? [];
  const avg = scored.length
    ? Math.round((scored.reduce((s, a) => s + (a.totalScore ?? 0), 0) / scored.length) * 10) / 10
    : null;
  const recent = (attempts ?? []).slice(0, 6);

  if (programs.data?.activeProgram === 'MULTILEVEL') return <section><h1 className="text-2xl font-bold">{greeting(studentName)}</h1><ExamTracks /><div className="my-4 grid grid-cols-2 gap-3">{(['listening','reading','writing','speaking'] as const).map((skill)=><button key={skill} className="card rounded-xl p-4 text-left capitalize" onClick={()=>onNavigate('exams')}>{skill}<span className="block text-sm normal-case opacity-60">{publishedMocks.filter((e)=>e.skills.includes(skill)).length} available exams</span></button>)}</div><MultilevelHistory refreshKey={0} /></section>;
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand/70">
              Overview
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
              {greeting(studentName)}
            </h1>
            <p className="mt-1 text-sm text-white/50">
              {inProgress.length > 0
                ? `You have ${inProgress.length} unfinished attempt${inProgress.length === 1 ? "" : "s"} — resume below.`
                : "Pick an exam when you're ready. Scores land in History after grading."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] text-white/35 sm:inline-flex" aria-live="polite">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" aria-hidden />
            Auto-sync
          </span>
          <button
            onClick={() => onNavigate("exams")}
            className="btn-brand rounded-xl px-4 py-2 text-sm font-bold"
          >
            Browse exams →
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading overview">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse rounded-2xl p-5">
              <div className="h-7 w-16 rounded bg-white/10" />
              <div className="mt-2 h-3 w-24 rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card mt-5 rounded-2xl border border-red-500/30 p-5">
          <p className="text-sm font-medium text-red-300">{error}</p>
          <p className="mt-1 text-[11px] text-white/30">Retrying automatically… check your connection.</p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { value: String(assigned), label: "assigned exams", accent: false },
              { value: String(ready), label: "ready to start", accent: true },
              { value: String(inProgress.length), label: "in progress", accent: inProgress.length > 0 },
              { value: completed > 0 || avg != null ? `${completed}` : "—", label: "completed", accent: false },
            ].map((s) => (
              <div key={s.label} className="card rounded-2xl p-5">
                <p className={`text-3xl font-black tabular-nums ${s.accent ? "text-brand" : "text-white"}`}>
                  {s.value}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-white/40">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {/* Resume panel */}
            <div className="card rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">Continue where you left off</h2>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/50 ring-1 ring-white/10">
                  {inProgress.length}
                </span>
              </div>
              {resumeError && (
                <p role="alert" className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {resumeError}
                </p>
              )}
              {inProgress.length === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-white/40">
                  Nothing in progress. Starting an exam from the Exams tab lets you resume it here if you leave.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {inProgress.slice(0, 4).map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-xl bg-black/30 px-3 py-2.5 ring-1 ring-white/10"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-white">
                          {a.testTitle ?? "Exam"}
                        </p>
                        <p className="text-[11px] text-white/40">started {formatDate(a.startedAt)}</p>
                      </div>
                      <button
                        onClick={() => void handleResume(a)}
                        disabled={resumingId !== null}
                        className="btn-brand shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-bold disabled:opacity-60"
                      >
                        {resumingId === a.id ? "Opening…" : "Resume →"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent activity */}
            <div className="card rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">Recent activity</h2>
                <button
                  onClick={() => onNavigate("history")}
                  className="text-xs font-semibold text-brand hover:text-brand-subtle-fg"
                >
                  Full history →
                </button>
              </div>
              {recent.length === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-white/40">
                  No attempts yet. Your finished exams and scores will show up here.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-white/5">
                  {recent.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-black ${
                          a.status === "completed"
                            ? "bg-brand/15 text-brand-subtle-fg"
                            : a.status === "grading"
                              ? "bg-amber-400/15 text-amber-200"
                              : "bg-sky-400/15 text-sky-200"
                        }`}
                      >
                        {a.status === "completed" ? "✓" : a.status === "grading" ? "…" : "▶"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-white">
                          {a.testTitle ?? "Exam"}
                        </p>
                        <p className="text-[11px] text-white/40">{formatDate(a.finishedAt ?? a.startedAt)}</p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-white/60">
                        {a.totalScore ?? a.autoScore ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
