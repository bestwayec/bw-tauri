import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Route } from "@/App";
import type { ApiError } from "@/lib/api";
import { isStaffRole } from "@/lib/auth";
import {
  listTests,
  myAttempts,
  startTest,
  type AttemptSummary,
  type StartResult,
  type TestListItem,
} from "@/lib/tests";
import { listMockExams, type MockExamListItem, type MockSkill, type MockStartResult } from "@/lib/mocks";
import { ExamTracks, usePrograms } from '@/components/ExamTracks';
import MultilevelHistory from '@/components/MultilevelHistory';
import ScorePredictionWidget from '@/components/ScorePredictionWidget';
import LiveExamPinJoin from '@/components/LiveExamPinJoin';
import { belongsToProgram, programQueryKey, type ExamProgram } from '@/lib/programs';
import { useSessionStore } from '@/lib/session-store';

type Props = {
  studentName: string | null;
  onNavigate: (route: Route) => void;
  onStart: (test: TestListItem, start: StartResult) => void;
  onStartMock?: (mock: MockExamListItem, start: MockStartResult, section?: MockSkill) => void;
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

const OVERVIEW_QUERY_OPTS = {
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  retry: (failureCount: number, error: unknown) => {
    const err = error as ApiError | undefined;
    if (
      err?.code === "SCHEMA_MISMATCH" ||
      (typeof err?.status === "number" && err.status >= 400 && err.status < 500)
    ) {
      return false;
    }
    return failureCount < 2;
  },
  retryDelay: (attempt: number) => Math.min(1_000 * 2 ** attempt, 5_000),
} as const;

export default function Dashboard({ studentName, onNavigate, onStart, onStartMock }: Props) {
  const programs = usePrograms();
  const userId = useSessionStore((state) => state.profile?.id);
  const userRole = useSessionStore((state) => state.profile?.role);
  const profileProgram = useSessionStore((state) => state.profile?.activeProgram);
  const staffUser = isStaffRole(userRole);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [watchdogExpired, setWatchdogExpired] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setWatchdogExpired(true), 4500);
    return () => window.clearTimeout(timer);
  }, []);

  const primaryProgram: ExamProgram =
    programs.data?.activeProgram ?? profileProgram ?? "MULTILEVEL";
  const altProgram: ExamProgram = primaryProgram === "IELTS" ? "MULTILEVEL" : "IELTS";

  const [testsQuery, attemptsQuery, mocksQuery] = useQueries({
    queries: [
      { queryKey: programQueryKey('tests', userId, primaryProgram), queryFn: () => listTests(50, primaryProgram), ...OVERVIEW_QUERY_OPTS },
      { queryKey: programQueryKey('my-attempts', userId, primaryProgram), queryFn: () => myAttempts(50, primaryProgram), ...OVERVIEW_QUERY_OPTS },
      { queryKey: programQueryKey('mock-exams', userId, primaryProgram), queryFn: () => listMockExams(primaryProgram), ...OVERVIEW_QUERY_OPTS },
    ],
  });

  const primaryEmpty =
    !testsQuery.isLoading &&
    !mocksQuery.isLoading &&
    (testsQuery.data?.length ?? 0) === 0 &&
    (mocksQuery.data?.length ?? 0) === 0;

  const [altTestsQuery, altMocksQuery] = useQueries({
    queries: [
      { queryKey: programQueryKey('tests', userId, altProgram), queryFn: () => listTests(50, altProgram), enabled: primaryEmpty, ...OVERVIEW_QUERY_OPTS },
      { queryKey: programQueryKey('mock-exams', userId, altProgram), queryFn: () => listMockExams(altProgram), enabled: primaryEmpty, ...OVERVIEW_QUERY_OPTS },
    ],
  });

  const useAltTrack =
    !programs.data?.activeProgram &&
    primaryEmpty &&
    ((altMocksQuery.data?.length ?? 0) > 0 || (altTestsQuery.data?.length ?? 0) > 0);

  const program: ExamProgram = useAltTrack ? altProgram : primaryProgram;
  const rawTests = useAltTrack ? (altTestsQuery.data ?? []) : (testsQuery.data ?? []);
  const rawMocks = useAltTrack ? (altMocksQuery.data ?? []) : (mocksQuery.data ?? []);

  const loading =
    !watchdogExpired &&
    (testsQuery.isLoading ||
      attemptsQuery.isLoading ||
      mocksQuery.isLoading ||
      (primaryEmpty && (altTestsQuery.isLoading || altMocksQuery.isLoading)));

  const error =
    testsQuery.isError && attemptsQuery.isError && mocksQuery.isError
      ? "Could not load overview. Retrying automatically…"
      : null;

  const matchesTrack = (type: string) => belongsToProgram(type, program);
  const tVisible = rawTests.filter((x) => x.questionCount > 0 && matchesTrack(x.type));
  const publishedMocks = rawMocks.filter(
    (x) => (x.isPublished || x.isDemo || staffUser) && x.questionCount > 0 && matchesTrack(x.type),
  );

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
  const attempts: AttemptSummary[] | null =
    attemptsQuery.data?.filter((attempt) => belongsToProgram(attempt.testType, program)) ?? null;

  async function handleResume(a: AttemptSummary) {
    const test = tests.find((t) => t.id === a.testId);
    if (!test) return;
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

  if (program === 'MULTILEVEL') {
    const skillMetadata: Record<'listening' | 'reading' | 'writing' | 'speaking', { title: string; desc: string; icon: React.ReactNode; color: string; bg: string }> = {
      listening: {
        title: "Listening",
        desc: "6 Parts · 35 Questions · Audio playback",
        icon: (
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
          </svg>
        ),
        color: "text-emerald-400",
        bg: "bg-emerald-500/10 border-emerald-500/20",
      },
      reading: {
        title: "Reading",
        desc: "5 Parts · 35 Questions · Dual-column passages",
        icon: (
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        ),
        color: "text-blue-400",
        bg: "bg-blue-500/10 border-blue-500/20",
      },
      writing: {
        title: "Writing",
        desc: "Task 1 & Task 2 · Word count analyzer",
        icon: (
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        ),
        color: "text-purple-400",
        bg: "bg-purple-500/10 border-purple-500/20",
      },
      speaking: {
        title: "Speaking",
        desc: "Parts 1-3 · Mic check & timed voice response",
        icon: (
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        ),
        color: "text-amber-400",
        bg: "bg-amber-500/10 border-amber-500/20",
      },
    };

    return (
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Multi-Level CEFR Track
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
              {greeting(studentName)}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Practice levels A1–C1 · Full Mock estimated evaluation: A2, B1, B2 or C1.
            </p>
          </div>
          <button
            onClick={() => onNavigate("exams")}
            className="btn-brand rounded-xl px-4 py-2 text-sm font-bold shadow-md hover:scale-[1.02] transition-transform"
          >
            Browse all exams →
          </button>
        </div>

        <ExamTracks />

        <LiveExamPinJoin
          onJoinedMock={onStartMock}
          onNavigateExams={() => onNavigate("exams")}
        />

        <ScorePredictionWidget
          program="MULTILEVEL"
          attempts={attempts}
          onPracticeWeakSkill={() => onNavigate("exams")}
        />

        {/* Hero Full Mock Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-[#111827] to-[#0B0F17] p-6 shadow-lg">
          <div className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
                Official CBT Sequence · {assigned} available
              </span>
              <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                Multi-Level CEFR CBT Full Mock Exam
              </h2>
              <p className="max-w-xl text-sm text-slate-300">
                1. Listening (45m) → 2. Reading (60m) → 3. Writing (60m) → 4. Speaking (15m).
                Full lockdown environment with AI evaluation out of 75 points.
              </p>
            </div>
            <button
              onClick={() => onNavigate("exams")}
              className="btn-brand shrink-0 rounded-xl px-6 py-3 font-bold text-black shadow-lg hover:scale-105 transition-transform"
            >
              Start Full Mock →
            </button>
          </div>
        </div>

        {/* 4 Skill Cards Grid */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Individual Practice Sections</h3>
            <span className="text-xs text-slate-400">Select a section to begin focused practice</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(['listening', 'reading', 'writing', 'speaking'] as const).map((skill) => {
              const meta = skillMetadata[skill];
              const count = publishedMocks.filter((e) => e.skills.includes(skill)).length;
              return (
                <div
                  key={skill}
                  className="group flex flex-col justify-between rounded-xl border border-emerald-500/15 bg-[#111827] p-4 transition-all hover:border-emerald-500/40 hover:bg-[#162032]"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className={`flex size-10 items-center justify-center rounded-xl border ${meta.bg} ${meta.color}`}>
                        {meta.icon}
                      </div>
                      <span className="rounded-full bg-[#0B0F17] border border-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                        {count} available
                      </span>
                    </div>
                    <h4 className="mt-3 font-bold capitalize text-white group-hover:text-emerald-400 transition-colors">
                      {meta.title}
                    </h4>
                    <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                      {meta.desc}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/10">
                    <button
                      onClick={() => onNavigate("exams")}
                      className="w-full rounded-lg bg-white/5 py-2 text-xs font-semibold text-white/80 group-hover:bg-emerald-500 group-hover:text-black transition-colors"
                    >
                      Practice Section →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
        <MultilevelHistory refreshKey={0} />
      </section>
    );
  }
  return (
    <section>
      <ExamTracks />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
              IELTS overview
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
              {greeting(studentName)}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {inProgress.length > 0
                ? `You have ${inProgress.length} unfinished attempt${inProgress.length === 1 ? "" : "s"} — resume below.`
                : "Pick an exam when you're ready. Scores land in History after grading."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] text-slate-400 sm:inline-flex" aria-live="polite">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
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

      <div className="mt-5 space-y-4">
        <LiveExamPinJoin
          onJoinedMock={onStartMock}
          onNavigateExams={() => onNavigate("exams")}
        />
        <ScorePredictionWidget
          program="IELTS"
          attempts={attempts}
          onPracticeWeakSkill={() => onNavigate("exams")}
        />
      </div>

      {loading ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading overview">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-emerald-500/15 bg-[#111827] animate-pulse p-5">
              <div className="h-7 w-16 rounded bg-slate-800" />
              <div className="mt-2 h-3 w-24 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-5 rounded-2xl border border-red-500/30 bg-[#111827] p-5">
          <p className="text-sm font-medium text-red-300">{error}</p>
          <p className="mt-1 text-[11px] text-slate-400">Retrying automatically… check your connection.</p>
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
              <div key={s.label} className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-5">
                <p className={`text-3xl font-black tabular-nums ${s.accent ? "text-emerald-400" : "text-white"}`}>
                  {s.value}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {/* Resume panel */}
            <div className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">Continue where you left off</h2>
                <span className="rounded-full bg-[#0B0F17] px-2 py-0.5 text-[11px] text-emerald-300 ring-1 ring-emerald-500/20">
                  {inProgress.length}
                </span>
              </div>
              {resumeError && (
                <p role="alert" className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {resumeError}
                </p>
              )}
              {inProgress.length === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Nothing in progress. Starting an exam from the Exams tab lets you resume it here if you leave.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {inProgress.slice(0, 4).map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-xl bg-[#0B0F17] px-3 py-2.5 ring-1 ring-emerald-500/15"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-white">
                          {a.testTitle ?? "Exam"}
                        </p>
                        <p className="text-[11px] text-slate-400">started {formatDate(a.startedAt)}</p>
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
            <div className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">Recent activity</h2>
                <button
                  onClick={() => onNavigate("history")}
                  className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  Full history →
                </button>
              </div>
              {recent.length === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  No attempts yet. Your finished exams and scores will show up here.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-white/5">
                  {recent.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-black ${
                          a.status === "completed"
                            ? "bg-emerald-500/15 text-emerald-300"
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
                        <p className="text-[11px] text-slate-400">{formatDate(a.finishedAt ?? a.startedAt)}</p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-slate-300">
                        {a.totalScore ?? a.autoScore ?? "—"}{a.totalScore != null || a.autoScore != null ? ' pts' : ''}
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
