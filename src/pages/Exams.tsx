import { useEffect, useState } from "react";
import { ExamTracks, usePrograms } from '@/components/ExamTracks';
import { isStaffRole } from '@/lib/auth';
import { PRACTICE_LEVELS, programQueryKey, type ExamProgram, type PracticeLevel } from '@/lib/programs';
import { matchesCatalogue, type CatalogueCategory } from '@/lib/catalogue';
import { useSessionStore } from '@/lib/session-store';
import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL, del, type ApiError } from "@/lib/api";
import { listTests, startTest, type StartResult, type TestListItem } from "@/lib/tests";
import {
  deleteMockExam,
  listMockExams,
  startMockExam,
  type MockAttemptMode,
  type MockExamListItem,
  type MockSkill,
  type MockStartResult,
} from "@/lib/mocks";
import MockSectionPicker, { type MockStartChoice } from "@/components/exam-ui/MockSectionPicker";
import LiveExamPinJoin from "@/components/LiveExamPinJoin";

type Props = {
  studentName: string | null;
  onStart: (test: TestListItem, start: StartResult) => void;
  onStartMock: (mock: MockExamListItem, start: MockStartResult, section?: MockSkill) => void;
};

const TYPE_STYLE: Record<string, string> = {
  ielts: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  ielts_academic: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  ielts_general: "bg-teal-400/10 text-teal-200 ring-teal-400/30",
  multilevel: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
};

type UnifiedItem =
  | { kind: "test"; data: TestListItem }
  | { kind: "mock"; data: MockExamListItem };

function Greeting({ name, isStaff }: { name: string | null; isStaff?: boolean }) {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
        {part}{name ? `, ${name.split(" ")[0]}` : ""}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-black tracking-tight text-white">
          {isStaff ? "Imtihonlar bazasi (Published Exams)" : "Ready for your exam?"}
        </h1>
        {isStaff && (
          <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            Teacher Preview Mode
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-400">
        {isStaff
          ? "Preview published mock exams, verify audio and sections, or manage exam availability."
          : "Pick a test below. Listening audio plays inside the runner — set your volume first."}
      </p>
    </div>
  );
}

const QUERY_OPTS = {
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

export default function Exams({ studentName, onStart, onStartMock }: Props) {
  const programs = usePrograms();
  const userId = useSessionStore((state) => state.profile?.id);
  const userRole = useSessionStore((state) => state.profile?.role);
  const profileProgram = useSessionStore((state) => state.profile?.activeProgram);
  const staffUser = isStaffRole(userRole);
  const canDeleteExam = staffUser;

  const [manualTrack, setManualTrack] = useState<ExamProgram | null>(null);
  const [practiceLevel, setPracticeLevel] = useState<PracticeLevel | 'All'>('All');
  const [category, setCategory] = useState<CatalogueCategory>('all');
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "mock" | "test"; id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [picker, setPicker] = useState<{ mock: MockExamListItem; mode: MockAttemptMode } | null>(null);
  const [watchdogExpired, setWatchdogExpired] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setWatchdogExpired(true), 4500);
    return () => window.clearTimeout(timer);
  }, []);

  const primaryProgram: ExamProgram =
    manualTrack ?? programs.data?.activeProgram ?? profileProgram ?? "MULTILEVEL";
  const altProgram: ExamProgram = primaryProgram === "IELTS" ? "MULTILEVEL" : "IELTS";

  const testsQuery = useQuery({
    queryKey: programQueryKey('tests', userId, primaryProgram),
    queryFn: () => listTests(50, primaryProgram),
    ...QUERY_OPTS,
  });

  // Fetch all published mocks for the track and filter practiceLevel client-side
  // so exams with profile="writing_speaking" are never hidden by server practice-only filters.
  const mocksQuery = useQuery({
    queryKey: programQueryKey('mock-exams', userId, primaryProgram),
    queryFn: () => listMockExams(primaryProgram),
    ...QUERY_OPTS,
  });

  const primaryEmpty =
    !testsQuery.isLoading &&
    !mocksQuery.isLoading &&
    (testsQuery.data?.length ?? 0) === 0 &&
    (mocksQuery.data?.length ?? 0) === 0;

  // When primary track has 0 published exams, automatically check the other track
  // so students whose default track was IELTS still see published Multilevel exams (and vice versa).
  const altMocksQuery = useQuery({
    queryKey: programQueryKey('mock-exams', userId, altProgram),
    queryFn: () => listMockExams(altProgram),
    enabled: primaryEmpty,
    ...QUERY_OPTS,
  });

  const altTestsQuery = useQuery({
    queryKey: programQueryKey('tests', userId, altProgram),
    queryFn: () => listTests(50, altProgram),
    enabled: primaryEmpty,
    ...QUERY_OPTS,
  });

  const useAltTrack =
    manualTrack === null &&
    primaryEmpty &&
    ((altMocksQuery.data?.length ?? 0) > 0 || (altTestsQuery.data?.length ?? 0) > 0);

  const program: ExamProgram = useAltTrack ? altProgram : primaryProgram;
  const rawTests = useAltTrack ? (altTestsQuery.data ?? []) : (testsQuery.data ?? []);
  const rawMocks = useAltTrack ? (altMocksQuery.data ?? []) : (mocksQuery.data ?? []);

  const testsError = testsQuery.error ? friendlyError(testsQuery.error) : null;
  const mocksError = mocksQuery.error ? friendlyError(mocksQuery.error) : null;

  const loading =
    !watchdogExpired &&
    ((programs.isLoading && !programs.data) ||
      testsQuery.isLoading ||
      mocksQuery.isLoading ||
      (primaryEmpty && (altMocksQuery.isLoading || altTestsQuery.isLoading)));

  const tests = rawTests.filter(
    (t) => t.questionCount > 0 && matchesCatalogue(t, program, practiceLevel, category),
  );
  const mocks = rawMocks.filter(
    (m) =>
      (m.isPublished || m.isDemo || staffUser) &&
      m.questionCount > 0 &&
      matchesCatalogue(m, program, practiceLevel, category),
  );

  const testsLoaded = testsQuery.status === "success" || altTestsQuery.status === "success";
  const mocksLoaded = mocksQuery.status === "success" || altMocksQuery.status === "success";

  const retry = () => {
    void programs.refetch();
    void testsQuery.refetch();
    void mocksQuery.refetch();
    void altMocksQuery.refetch();
    void altTestsQuery.refetch();
  };

  async function handleStartTest(test: TestListItem) {
    setStartingId(test.id);
    setStartError(null);
    try {
      const start = await startTest(test.id);
      onStart(test, start);
    } catch (e) {
      setStartError(`${test.title}: ${friendlyError(e)}`);
    } finally {
      setStartingId(null);
    }
  }

  function handleStartMock(mock: MockExamListItem, mode: MockAttemptMode) {
    if (mock.ready === false) return;
    setStartError(null);
    setPicker({ mock, mode });
  }

  /** Modal confirmed: start (or resume) the attempt with the chosen scope. */
  async function startChosen(choice: MockStartChoice) {
    const mock = picker?.mock;
    if (!mock) return;
    setStartingId(`mock:${mock.id}`);
    setStartError(null);
    try {
      const start = await startMockExam(mock.id, {
        mode: choice.mode,
        flow: choice.flow,
        section: choice.section,
      });
      setPicker(null);
      onStartMock(mock, start, choice.section);
    } catch (e) {
      setStartError(`${mock.title}: ${friendlyError(e)}`);
    } finally {
      setStartingId(null);
    }
  }

  const allTests = tests;
  const allMocks: UnifiedItem[] = [
    ...allTests.map((t) => ({ kind: "test" as const, data: t })),
    ...mocks.map((m) => ({ kind: "mock" as const, data: m })),
  ];

  const totalUnfiltered =
    rawTests.filter((t) => t.questionCount > 0).length +
    rawMocks.filter((m) => (m.isPublished || m.isDemo || staffUser) && m.questionCount > 0).length;
  const totalAssigned = allTests.length + mocks.length;
  const totalQuestions =
    allTests.reduce((s, t) => s + t.questionCount, 0) +
    mocks.reduce((s, m) => s + m.questionCount, 0);
  const readyCount =
    allTests.filter((t) => t.questionCount > 0).length +
    mocks.filter((m) => m.questionCount > 0 && m.ready !== false).length;

  return (
    <section>
      <ExamTracks />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Greeting name={studentName} isStaff={staffUser} />
        <div className="flex items-center gap-2">
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
                  onClick={() => {
                    setManualTrack(trk);
                    setPracticeLevel("All");
                    setCategory("all");
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-emerald-500 text-slate-950 shadow-sm"
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
        </div>
      </div>

      <div className="mt-4">
        <LiveExamPinJoin onJoinedMock={(mock, start) => onStartMock(mock, start)} />
      </div>

      <h2 className="mt-5 text-lg font-bold text-slate-100">
        {program === 'IELTS' ? 'IELTS exams' : 'Multilevel exams'}
      </h2>

      <div className="mt-3 rounded-2xl border border-emerald-500/15 bg-[#111827] p-4 space-y-3">
        {program === 'MULTILEVEL' && (
          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">Practice content level (CEFR)</p>
            <div className="flex flex-wrap gap-2" aria-label="Practice level">
              {(['All', ...PRACTICE_LEVELS] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={practiceLevel === level}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    practiceLevel === level
                      ? 'btn-brand'
                      : 'btn-ghost border border-emerald-500/15'
                  }`}
                  onClick={() => {
                    setPracticeLevel(level);
                    if (level !== 'All' && category === 'full_mock') setCategory('all');
                  }}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-slate-400">Skill / Exam Category</p>
          <div className="flex flex-wrap gap-2" aria-label="Exam category">
            {(['all', 'full_mock', 'listening', 'reading', 'writing', 'speaking'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize transition ${
                  category === value
                    ? 'btn-brand'
                    : 'btn-ghost border border-emerald-500/15'
                }`}
                onClick={() => {
                  setCategory(value);
                  if (value === 'full_mock') setPracticeLevel('All');
                }}
              >
                {value === 'full_mock' ? 'Full Mock' : value === 'all' ? 'All skills' : value}
              </button>
            ))}
          </div>
        </div>

        {program === 'MULTILEVEL' && (
          <p className="text-xs text-slate-400">
            A1–C1 describe practice content. Full Mock estimated results remain Below B1 / B1 / B2 / C1.
          </p>
        )}
      </div>

      {!loading && (testsLoaded || mocksLoaded) && (
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-3 text-center">
            <p className="text-xl font-black text-white">{totalAssigned}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-400">assigned</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-3 text-center">
            <p className="text-xl font-black text-white">{totalQuestions}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-400">questions</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-3 text-center">
            <p className="text-xl font-black text-emerald-400">{readyCount}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-400">ready</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="mt-4 space-y-3" aria-label="Loading exams">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-2xl border border-emerald-500/15 bg-[#111827] animate-pulse p-5">
              <div className="h-4 w-1/2 rounded bg-slate-800" />
              <div className="mt-2 h-3 w-1/4 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      )}

      {!loading && testsError && mocksError && (
        <div className="mt-4 space-y-3" role="alert">
          <SourceErrorCard
            source="Mock exams"
            detail={mocksError}
            onRetry={retry}
          />
        </div>
      )}

      {!loading && !(testsError && mocksError) && allMocks.length === 0 && (
        <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-[#111827] p-8 text-center">
          <p className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-emerald-500/25 bg-emerald-500/10 text-xl">
            🎯
          </p>
          <p className="mt-3 text-base font-bold text-slate-100">
            {totalUnfiltered > 0 && (practiceLevel !== 'All' || category !== 'all')
              ? 'No exams match these filters'
              : "Hozircha faol imtihonlar mavjud emas. Yangi mock e'lon qilinganda bu yerda ko'rinadi."}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-400">
            {totalUnfiltered > 0 && (practiceLevel !== 'All' || category !== 'all')
              ? 'Reset the level or skill filter below to view all published exams on this track.'
              : 'New tests and mock exams appear here automatically once published. The list refreshes every 30s and when you return to this window.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {totalUnfiltered > 0 && (practiceLevel !== 'All' || category !== 'all') ? (
              <button
                type="button"
                onClick={() => {
                  setPracticeLevel('All');
                  setCategory('all');
                }}
                className="btn-brand rounded-xl px-4 py-2 text-xs font-bold"
              >
                Reset filters ({totalUnfiltered} available)
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setManualTrack(program === "IELTS" ? "MULTILEVEL" : "IELTS")}
                  className="btn-brand rounded-xl px-4 py-2 text-xs font-bold"
                >
                  Check {program === "IELTS" ? "Multi-Level (CEFR)" : "IELTS"} Track
                </button>
                <button
                  type="button"
                  onClick={retry}
                  className="btn-ghost rounded-xl border border-emerald-500/20 px-4 py-2 text-xs font-semibold"
                >
                  ↻ Refresh
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!loading && allMocks.length > 0 && (
        <ul className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {allMocks.map((item, idx) => {
            if (item.kind === "test") {
              const t = item.data;
              const empty = t.questionCount === 0;
              return (
                <li
                  key={`test-${t.id}`}
                  className="animate-rise group rounded-2xl border border-emerald-500/15 bg-[#111827] p-5 transition hover:border-emerald-500/35"
                  style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${TYPE_STYLE[t.type] ?? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"}`}
                        >
                          {t.type}
                        </span>
                        {(program === 'MULTILEVEL' ? t.practiceLevel : t.level) && (
                          <span className="rounded-full bg-[#0B0F17] px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
                            {program === 'MULTILEVEL' ? `Practice ${t.practiceLevel}` : t.level}
                          </span>
                        )}
                        {t.isDemo && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                            demo
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 truncate text-base font-bold text-white">{t.title}</p>
                      <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                        {t.durationMinutes != null && <span>⏱ {t.durationMinutes} min</span>}
                        <span>❓ {t.questionCount} questions</span>
                      </p>
                      {t.sections?.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1">
                          {t.sections.map((s) => (
                            <span
                              key={s}
                              className="rounded-md bg-[#0B0F17] px-1.5 py-0.5 text-[10px] font-medium text-slate-300 ring-1 ring-emerald-500/15"
                            >
                              {s}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canDeleteExam && (
                        <button
                          type="button"
                          title="Imtihonni o'chirish"
                          aria-label={`Delete ${t.title}`}
                          onClick={() => setDeleteTarget({ kind: "test", id: t.id, title: t.title })}
                          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-bold text-red-300 hover:bg-red-500/20"
                        >
                          🗑
                        </button>
                      )}
                      <button
                        onClick={() => void handleStartTest(t)}
                        disabled={startingId !== null || empty}
                        className="btn-brand shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-50"
                      >
                        {startingId === t.id ? "Starting…" : empty ? "Empty" : "Start →"}
                      </button>
                    </div>
                  </div>
                  {empty && (
                    <p className="mt-2 text-[11px] text-amber-300/80">
                      This test has no questions yet — starting will fail (TEST_EMPTY) until an admin adds some.
                    </p>
                  )}
                </li>
              );
            } else {
              const m = item.data;
              const empty = m.questionCount === 0;
              const mockType = m.type === "ielts_academic" ? "IELTS Academic" : m.type === "ielts_general" ? "IELTS General" : "Multilevel";
              const canAccessMock = m.access === "granted" || m.isPublished || m.isDemo || staffUser;
              return (
                <li
                  key={`mock-${m.id}`}
                  className="animate-rise group rounded-2xl border border-emerald-500/15 bg-[#111827] p-5 transition hover:border-emerald-500/35"
                  style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${TYPE_STYLE[m.type] ?? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"}`}>
                          {m.type === "multilevel" ? "multilevel" : "ielts"}
                        </span>
                        {(program === 'MULTILEVEL' ? m.practiceLevel : m.level) && (
                          <span className="rounded-full bg-[#0B0F17] px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
                            {program === 'MULTILEVEL' ? `Practice ${m.practiceLevel}` : m.level}
                          </span>
                        )}
                        {m.isDemo && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                            demo
                          </span>
                        )}
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                          mock
                        </span>
                      </div>
                      <p className="mt-1.5 truncate text-base font-bold text-white" title={m.title}>
                        {m.title}
                      </p>
                      <p className="text-[11px] text-slate-400">{mockType}</p>
                      <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                        {m.durationMinutes != null && <span>⏱ {m.durationMinutes} min</span>}
                        <span>❓ {m.questionCount} questions</span>
                        {m.skills.length > 0 && <span>· {m.skills.join(" · ")}</span>}
                      </p>
                      {m.description && (
                        <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">{m.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Mock</p>
                      <p className="mt-1 text-[11px] text-slate-400">{empty ? "Empty" : `${m.questionCount} Q`}</p>
                      {canDeleteExam && (
                        <button
                          type="button"
                          title="Imtihonni o'chirish"
                          aria-label={`Delete ${m.title}`}
                          onClick={() => setDeleteTarget({ kind: "mock", id: m.id, title: m.title })}
                          className="mt-2 inline-flex items-center rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-bold text-red-300 hover:bg-red-500/20"
                        >
                          🗑 O&apos;chirish
                        </button>
                      )}
                    </div>
                  </div>
                  {empty && (
                    <p className="mt-2 text-[11px] text-amber-300/80">This mock has no questions yet — it will be available after an admin adds content.</p>
                  )}
                  {!empty && m.ready === false && (
                    <p className="mt-2 text-[11px] text-amber-300/80">This Multilevel exam is not ready yet. Please ask an administrator to repair or complete its blueprint.</p>
                  )}
                  {!empty && m.ready !== false && canAccessMock && (
                    <div className="mt-3 flex gap-2">
                      {(["practice", "timed"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => void handleStartMock(m, mode)}
                          disabled={startingId !== null}
                          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold capitalize transition disabled:opacity-50 ${
                            mode === "timed"
                              ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/35 hover:bg-emerald-500/25"
                              : "btn-brand"
                          }`}
                        >
                          {startingId === `mock:${m.id}` ? "Starting…" : mode === "timed" ? "⏱ Timed" : "Start →"}
                        </button>
                      ))}
                    </div>
                  )}
                  {!empty && !canAccessMock && m.access === "pending" && (
                    <p className="mt-2 text-[11px] text-amber-300/80">
                      Admin tasdig‘ini kuting — bu mock hali ochilmagan.
                      <span className="block text-slate-400">Waiting for admin confirmation before you can start this mock.</span>
                    </p>
                  )}
                  {!empty && !canAccessMock && m.access === "locked" && (
                    <p className="mt-2 text-[11px] text-slate-400">
                      Bu mock sotuvda — admin bilan bog‘laning.
                      <span className="block text-slate-500">This mock needs a purchase — ask your admin.</span>
                    </p>
                  )}
                </li>
              );
            }
          })}
        </ul>
      )}

      {startError && !picker && (
        <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {startError}
        </p>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl border border-emerald-500/20 bg-[#111827] p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white">Imtihonni o&apos;chirishni tasdiqlang</h3>
            <p className="mt-2 text-xs text-slate-300">
              &ldquo;{deleteTarget.title}&rdquo; imtihonini butunlay o&apos;chirib tashlamoqchimisiz? Bu amalni ortga qaytarib bo&apos;lmaydi.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-emerald-500/20 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setStartError(null);
                  try {
                    if (deleteTarget.kind === "mock") {
                      await deleteMockExam(deleteTarget.id);
                      await mocksQuery.refetch();
                    } else {
                      await del(`/v1/tests/${encodeURIComponent(deleteTarget.id)}`);
                      await testsQuery.refetch();
                    }
                    setDeleteTarget(null);
                  } catch (e) {
                    setStartError(friendlyError(e));
                    setDeleteTarget(null);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "O'chirilmoqda..." : "O'chirish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {picker && (
        <MockSectionPicker
          exam={picker.mock}
          mode={picker.mode}
          busy={startingId !== null}
          error={startError}
          onCancel={() => {
            setPicker(null);
            setStartError(null);
          }}
          onStart={(choice) => void startChosen(choice)}
        />
      )}
    </section>
  );
}

function SourceErrorCard({
  source,
  detail,
  onRetry,
}: {
  source: string;
  detail: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-[#111827] p-5">
      <p className="text-sm font-medium text-red-300">Could not load {source}</p>
      <p className="mt-1 text-xs text-slate-300">{detail}</p>
      <p className="mt-1 break-all font-mono text-[11px] text-slate-500">API: {API_BASE_URL}</p>
      <p className="mt-1 text-[11px] text-slate-400">
        Check your connection and that the backend is reachable, then retry. The list also refreshes automatically.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="btn-brand mt-3 rounded-xl px-4 py-2 text-sm font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

function friendlyError(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const { code, message, status } = e as {
      code?: unknown;
      message?: unknown;
      status?: unknown;
    };
    if (typeof message === "string" && message) {
      return typeof code === "string" && code ? `${message} (${code})` : message;
    }
    if (typeof status === "number") return `Request failed: ${status}`;
  }
  if (e instanceof Error && e.message) return e.message;
  return "Request failed. Check connection.";
}
