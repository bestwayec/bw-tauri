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
import {
  listMockExams,
  startMockExam,
  type MockAttemptMode,
  type MockExamListItem,
  type MockSkill,
  type MockStartResult,
} from "@/lib/mocks";
import { ExamTracks, usePrograms } from "@/components/ExamTracks";
import MultilevelHistory from "@/components/MultilevelHistory";
import ScorePredictionWidget, {
  computeFallbackPrediction,
  multilevelScoreToCefr,
} from "@/components/ScorePredictionWidget";
import LiveExamPinJoin from "@/components/LiveExamPinJoin";
import MockSectionPicker, { type MockStartChoice } from "@/components/exam-ui/MockSectionPicker";
import { belongsToProgram, programQueryKey, type ExamProgram } from "@/lib/programs";
import { useSessionStore } from "@/lib/session-store";

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
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  const [manualTrack, setManualTrack] = useState<ExamProgram | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [startingMockId, setStartingMockId] = useState<string | null>(null);
  const [startMockError, setStartMockError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ mock: MockExamListItem; mode: MockAttemptMode; defaultSection?: MockSkill } | null>(null);
  const [watchdogExpired, setWatchdogExpired] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setWatchdogExpired(true), 4500);
    return () => window.clearTimeout(timer);
  }, []);

  const primaryProgram: ExamProgram =
    manualTrack ?? programs.data?.activeProgram ?? profileProgram ?? "MULTILEVEL";
  const altProgram: ExamProgram = primaryProgram === "IELTS" ? "MULTILEVEL" : "IELTS";

  const [testsQuery, attemptsQuery, mocksQuery] = useQueries({
    queries: [
      {
        queryKey: programQueryKey("tests", userId, primaryProgram),
        queryFn: () => listTests(50, primaryProgram),
        ...OVERVIEW_QUERY_OPTS,
      },
      {
        queryKey: programQueryKey("my-attempts", userId, primaryProgram),
        queryFn: () => myAttempts(50, primaryProgram),
        ...OVERVIEW_QUERY_OPTS,
      },
      {
        queryKey: programQueryKey("mock-exams", userId, primaryProgram),
        queryFn: () => listMockExams(primaryProgram),
        ...OVERVIEW_QUERY_OPTS,
      },
    ],
  });

  const primaryEmpty =
    !testsQuery.isLoading &&
    !mocksQuery.isLoading &&
    (testsQuery.data?.length ?? 0) === 0 &&
    (mocksQuery.data?.length ?? 0) === 0;

  const [altTestsQuery, altMocksQuery] = useQueries({
    queries: [
      {
        queryKey: programQueryKey("tests", userId, altProgram),
        queryFn: () => listTests(50, altProgram),
        enabled: primaryEmpty && manualTrack === null,
        ...OVERVIEW_QUERY_OPTS,
      },
      {
        queryKey: programQueryKey("mock-exams", userId, altProgram),
        queryFn: () => listMockExams(altProgram),
        enabled: primaryEmpty && manualTrack === null,
        ...OVERVIEW_QUERY_OPTS,
      },
    ],
  });

  const useAltTrack =
    manualTrack === null &&
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

  const assigned = tests.length;
  const ready = tests.filter((t) => t.questionCount > 0).length;
  const inProgress = attempts?.filter((a) => a.status === "in_progress") ?? [];
  const completed = attempts?.filter((a) => a.status === "completed").length ?? 0;
  const scored = attempts?.filter((a) => a.totalScore != null) ?? [];
  const avg = scored.length
    ? Math.round((scored.reduce((s, a) => s + (a.totalScore ?? 0), 0) / scored.length) * 10) / 10
    : null;
  const recent = (attempts ?? []).slice(0, 6);

  // Compute live prediction stats
  const prediction = computeFallbackPrediction(attempts, program);
  const targetPct = prediction.targetProgressPct;
  const cefrBadge = program === "MULTILEVEL" ? prediction.cefrLevel : multilevelScoreToCefr(prediction.predictedMultilevelScore);

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

  function handleStartMockChoice(mock: MockExamListItem, defaultSection?: MockSkill) {
    if (mock.ready === false) return;
    setStartMockError(null);
    setPicker({ mock, mode: "timed", defaultSection });
  }

  async function confirmStartMock(choice: MockStartChoice) {
    const mock = picker?.mock;
    if (!mock || !onStartMock) return;
    setStartingMockId(mock.id);
    setStartMockError(null);
    try {
      const start = await startMockExam(mock.id, {
        mode: choice.mode,
        flow: choice.flow,
        section: choice.section,
      });
      setPicker(null);
      onStartMock(mock, start, choice.section);
    } catch (e) {
      setStartMockError(`${mock.title}: ${friendlyError(e)}`);
    } finally {
      setStartingMockId(null);
    }
  }

  const primaryMock = publishedMocks[0] ?? null;

  const skillMetadata: Record<
    "listening" | "reading" | "writing" | "speaking",
    { title: string; desc: string; icon: React.ReactNode; color: string; bg: string }
  > = {
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
      desc: "Task 1 & Task 2 · Word count analyzer & AI review",
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
      desc: "Parts 1-3 · Mic check & live voice response",
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
      <ExamTracks />

      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
            {program === "MULTILEVEL" ? "Multi-Level (CEFR) Command Center" : "IELTS Command Center"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-black tracking-tight text-white">
              {greeting(studentName)}
            </h1>
            {staffUser && (
              <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Staff Preview
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {inProgress.length > 0
              ? `You have ${inProgress.length} unfinished attempt${inProgress.length === 1 ? "" : "s"} · resume below.`
              : "Monitor your CEFR/IELTS progress, tackle full mock simulations, or practice individual skills."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Track Toggle */}
          <div
            className="inline-flex rounded-xl border border-emerald-500/20 bg-[#111827] p-1"
            role="group"
            aria-label="Track view filter"
          >
            {(["IELTS", "MULTILEVEL"] as const).map((trk) => {
              const active = program === trk;
              return (
                <button
                  key={trk}
                  type="button"
                  onClick={() => setManualTrack(trk)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-emerald-500 text-slate-950 font-bold shadow-sm"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  {trk === "IELTS" ? "IELTS" : "Multi-Level (CEFR)"}
                </button>
              );
            })}
          </div>

          <span className="hidden items-center gap-1.5 text-[11px] text-slate-400 sm:inline-flex" aria-live="polite">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            Auto-sync
          </span>

          <button
            onClick={() => onNavigate("exams")}
            className="btn-brand rounded-xl px-4 py-2 text-sm font-bold shadow-md hover:scale-[1.02] transition-transform"
          >
            Browse all exams →
          </button>
        </div>
      </div>

      {/* Live PIN Join */}
      <LiveExamPinJoin
        onJoinedMock={onStartMock}
        onNavigateExams={() => onNavigate("exams")}
      />

      {/* Hero CEFR / IELTS Level & Goal Progress Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-[#111827] via-[#0F172A] to-[#0B0F17] p-6 shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative z-10 grid gap-6 md:grid-cols-12 md:items-center">
          <div className="space-y-2 md:col-span-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                ✨ Estimated Level: {cefrBadge} ({program === "MULTILEVEL" ? `${prediction.predictedMultilevelScore}/75 pts` : `Band ${prediction.predictedBand}`})
              </span>
              <span className="text-xs text-slate-400">
                Confidence: {prediction.confidencePct}% · {prediction.attemptsCount} attempts analysed
              </span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              {program === "MULTILEVEL"
                ? "Target CEFR Goal: C1 Level (65+ Points)"
                : "Target IELTS Goal: Band 7.5 (Academic / General)"}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
              {program === "MULTILEVEL"
                ? "Your recent diagnostic performance places you firmly at the B2/C1 boundary. Strengthening Writing Task 2 Cohesion and Listening Part 3 distractors will unlock official C1 certification."
                : "Your weighted score trend indicates solid Band 6.5 proficiency. Target high-accuracy Reading Passage 3 scanning to advance toward Band 7.5."}
            </p>

            {/* Target Progress Bar */}
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-emerald-400">Progress to Target Goal</span>
                <span className="font-mono text-white">{targetPct}% Achieved</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800 ring-1 ring-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                  style={{ width: `${Math.max(5, targetPct)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 md:col-span-4 md:items-end">
            {primaryMock && onStartMock && (
              <button
                onClick={() => handleStartMockChoice(primaryMock)}
                className="btn-brand w-full md:w-auto rounded-xl px-6 py-3 font-bold text-slate-950 shadow-lg hover:scale-105 transition-transform"
              >
                Start Full Simulation →
              </button>
            )}
            <button
              onClick={() => onNavigate("exams")}
              className="btn-ghost w-full md:w-auto rounded-xl border border-emerald-500/20 px-5 py-2.5 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800"
            >
              Choose Custom Section
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-[#111827] p-4 text-xs text-red-300">
          <p className="font-semibold">{error}</p>
          <p className="mt-0.5 text-slate-400">Retrying automatically… please check your connection.</p>
        </div>
      )}

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-emerald-500/15 bg-[#111827]" />
          ))}
        </div>
      )}

      {/* 4-Card Gamification & KPI Bar */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Available Exams",
            value: String(assigned),
            sub: ready > 0 ? `${ready} ready to start` : "Syncing exams…",
            accent: true,
            icon: "📚",
          },
          {
            label: "Learning Streak",
            value: completed > 0 ? `${Math.min(7, completed + 2)} Days` : "Active",
            sub: "🔥 Daily Practice Streak",
            accent: false,
            icon: "🔥",
          },
          {
            label: "Active In Progress",
            value: String(inProgress.length),
            sub: inProgress.length > 0 ? "Resume current session" : "All caught up",
            accent: inProgress.length > 0,
            icon: "⏳",
          },
          {
            label: "Completed Tests",
            value: completed > 0 || avg != null ? `${completed}` : "0",
            sub: avg != null ? `Avg score: ${avg} pts` : "First score after submit",
            accent: false,
            icon: "✓",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-[#111827] p-5 shadow-sm transition-all hover:border-emerald-500/30"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{card.label}</p>
              <p className={`mt-1 text-2xl font-black tabular-nums ${card.accent ? "text-emerald-400" : "text-white"}`}>
                {card.value}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">{card.sub}</p>
            </div>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-lg">
              {card.icon}
            </span>
          </div>
        ))}
      </div>

      {/* Hero Full Mock CBT Callout Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-[#111827] to-[#0B0F17] p-6 shadow-lg">
        <div className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
              Official CBT Sequence · {assigned} Available
            </span>
            <h3 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              {program === "MULTILEVEL"
                ? "Multi-Level CEFR CBT Full Mock Exam"
                : "IELTS CBT Full Mock Simulation"}
            </h3>
            <p className="max-w-xl text-sm text-slate-300">
              {program === "MULTILEVEL"
                ? "1. Listening (45m) → 2. Reading (60m) → 3. Writing (60m) → 4. Speaking (15m). Full lockdown environment with DeepSeek / Qwen AI rubric evaluation out of 75 points."
                : "Official 4-part IELTS computer-delivered test with synchronized audio streaming, dual-column reading, and auto-timed examiner prompts."}
            </p>
          </div>
          <div className="shrink-0 flex flex-col gap-2">
            {primaryMock && onStartMock ? (
              <button
                onClick={() => handleStartMockChoice(primaryMock)}
                className="btn-brand rounded-xl px-6 py-3 font-bold text-slate-950 shadow-lg hover:scale-105 transition-transform"
              >
                Start Full Mock →
              </button>
            ) : (
              <button
                onClick={() => onNavigate("exams")}
                className="btn-brand rounded-xl px-6 py-3 font-bold text-slate-950 shadow-lg hover:scale-105 transition-transform"
              >
                Browse Exams →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4 Individual Practice Skill Cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Individual Skill Practice</h3>
            <p className="text-xs text-slate-400">Target one specific section without sitting the full exam</p>
          </div>
          <button
            onClick={() => onNavigate("exams")}
            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
          >
            All sections →
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(["listening", "reading", "writing", "speaking"] as const).map((skill) => {
            const meta = skillMetadata[skill];
            const count = publishedMocks.filter((e) => e.skills.includes(skill)).length;
            const mockWithSkill = publishedMocks.find((e) => e.skills.includes(skill)) ?? primaryMock;

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
                    onClick={() => {
                      if (mockWithSkill && onStartMock) {
                        handleStartMockChoice(mockWithSkill, skill);
                      } else {
                        onNavigate("exams");
                      }
                    }}
                    className="w-full rounded-lg bg-white/5 py-2 text-xs font-semibold text-white/80 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors"
                  >
                    Practice {meta.title} →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Weakness Map & Score Prediction Widget */}
      <ScorePredictionWidget
        program={program}
        attempts={attempts}
        onPracticeWeakSkill={() => onNavigate("exams")}
      />

      {/* Active In-Progress and Recent Activity Panels */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Continue in-progress */}
        <div className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Continue where you left off</h3>
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
              Nothing in progress. Starting an exam from Exams or above lets you resume it here at any time.
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
                      {a.testTitle ?? "Exam Session"}
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
            <h3 className="text-sm font-bold text-white">Recent activity</h3>
            <button
              onClick={() => onNavigate("history")}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              Full history →
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              No recent attempts yet. Your finished exams and detailed scores will automatically appear here.
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
                    {a.totalScore ?? a.autoScore ?? "—"}{a.totalScore != null || a.autoScore != null ? " pts" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {program === "MULTILEVEL" && (
        <MultilevelHistory refreshKey={0} />
      )}

      {/* Modal: Section Picker */}
      {picker && (
        <MockSectionPicker
          exam={picker.mock}
          mode={picker.mode}
          busy={startingMockId !== null}
          error={startMockError}
          onCancel={() => {
            setPicker(null);
            setStartMockError(null);
          }}
          onStart={confirmStartMock}
        />
      )}
    </section>
  );
}
