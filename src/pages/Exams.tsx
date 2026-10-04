import { useState } from "react";
import { ExamTracks, usePrograms } from '@/components/ExamTracks';
import { PRACTICE_LEVELS, programQueryKey, type PracticeLevel } from '@/lib/programs';
import { matchesCatalogue, type CatalogueCategory } from '@/lib/catalogue';
import { useSessionStore } from '@/lib/session-store';
import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { listTests, startTest, type StartResult, type TestListItem } from "@/lib/tests";
import {
  listMockExams,
  startMockExam,
  type MockAttemptMode,
  type MockExamListItem,
  type MockStartResult,
} from "@/lib/mocks";

type Props = {
  studentName: string | null;
  onStart: (test: TestListItem, start: StartResult) => void;
  onStartMock: (mock: MockExamListItem, start: MockStartResult) => void;
};

const TYPE_STYLE: Record<string, string> = {
  ielts: "bg-sky-400/10 text-sky-200 ring-sky-400/30",
  ielts_academic: "bg-sky-400/10 text-sky-200 ring-sky-400/30",
  ielts_general: "bg-teal-400/10 text-teal-200 ring-teal-400/30",
  multilevel: "bg-violet-400/10 text-violet-200 ring-violet-400/30",
};

type UnifiedItem =
  | { kind: "test"; data: TestListItem }
  | { kind: "mock"; data: MockExamListItem };

function Greeting({ name }: { name: string | null }) {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand/70">
        {part}{name ? `, ${name.split(" ")[0]}` : ""}
      </p>
      <h1 className="mt-1 text-2xl font-black tracking-tight text-white">Ready for your exam?</h1>
      <p className="mt-1 text-sm text-white/50">
        Pick a test below. Listening audio plays inside the runner — set your volume first.
      </p>
    </div>
  );
}

/**
 * TanStack Query fetching: cached per source (stale-while-revalidate),
 * exponential-backoff retries, refetch on focus/online, background refresh
 * every 30s. This screen unmounts during an exam, so no exam-time polling;
 * background refills also pause while the window is hidden.
 */
const QUERY_OPTS = {
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  retry: 3,
  retryDelay: (attempt: number) => Math.min(1_000 * 2 ** attempt, 15_000),
} as const;

export default function Exams({ studentName, onStart, onStartMock }: Props) {
  const programs = usePrograms();
  const program = programs.data?.activeProgram;
  const userId = useSessionStore((state) => state.profile?.id);
  const [practiceLevel, setPracticeLevel] = useState<PracticeLevel | 'All'>('All');
  const [category, setCategory] = useState<CatalogueCategory>('all');
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const testsQuery = useQuery({
    queryKey: programQueryKey('tests', userId, program),
    queryFn: () => listTests(50, program ?? undefined),
    enabled: !!program,
    ...QUERY_OPTS,
  });
  const mocksQuery = useQuery({
    queryKey: [...programQueryKey('mock-exams', userId, program), program === 'MULTILEVEL' ? practiceLevel : 'All'],
    queryFn: () => listMockExams(program ?? undefined, program === 'MULTILEVEL' && practiceLevel !== 'All' ? practiceLevel : undefined),
    enabled: !!program,
    ...QUERY_OPTS,
  });

  // Per-source errors: a failed source must NEVER look like "no exams".
  // Each fetch reports its own failure; the empty state renders only when a
  // source genuinely succeeded with zero items.
  const testsError = testsQuery.error ? friendlyError(testsQuery.error) : null;
  const mocksError = mocksQuery.error ? friendlyError(mocksQuery.error) : null;
  const loading = programs.isPending || (testsQuery.isPending && testsQuery.fetchStatus !== "idle") || (mocksQuery.isPending && mocksQuery.fetchStatus !== "idle");

  // Students can never start a 0-question exam (backend throws TEST_EMPTY),
  // so hide them outright — an empty row is always junk (seed leftover or
  // unfinished admin draft), never a real assigned exam.
  const tests = (testsQuery.data ?? []).filter((t) => t.questionCount > 0 && !!program && matchesCatalogue(t, program, practiceLevel, category));
  // Only show published mocks to students; keep demos visible.
  const mocks = (mocksQuery.data ?? []).filter((m) => (m.isPublished || m.isDemo) && m.questionCount > 0 && !!program && matchesCatalogue(m, program, practiceLevel, category));
  const testsLoaded = testsQuery.status === "success";
  const mocksLoaded = mocksQuery.status === "success";

  const retry = () => {
    void testsQuery.refetch();
    void mocksQuery.refetch();
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

  async function handleStartMock(mock: MockExamListItem, mode: MockAttemptMode) {
    setStartingId(`mock:${mock.id}`);
    setStartError(null);
    try {
      const start = await startMockExam(mock.id, { mode, flow: mock.type === 'multilevel' && mock.profile === 'full_mock' ? 'full_test' : 'single_skill' });
      onStartMock(mock, start);
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

  // Stats over real server data
  const totalAssigned = allTests.length + mocks.length;
  const totalQuestions = allTests.reduce((s, t) => s + t.questionCount, 0) + mocks.reduce((s, m) => s + m.questionCount, 0);
  const readyCount = allTests.filter((t) => t.questionCount > 0).length + mocks.filter((m) => m.questionCount > 0).length;

  return (
    <section>
      <ExamTracks />
      <div className="flex items-start justify-between gap-3">
        <Greeting name={studentName} />
        <span className="hidden items-center gap-1.5 text-[11px] text-white/35 sm:inline-flex" aria-live="polite">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" aria-hidden />
          Auto-sync
        </span>
      </div>

      {program && <h2 className="mt-4 text-lg font-bold">{program === 'IELTS' ? 'IELTS exams' : 'Multilevel exams'}</h2>}
      {program === 'MULTILEVEL' && <div className="mt-3 space-y-3">
        <div><p className="mb-2 text-xs text-white/50">Practice content level</p><div className="flex flex-wrap gap-2" aria-label="Practice level">{(['All', ...PRACTICE_LEVELS] as const).map((level) => <button key={level} type="button" aria-pressed={practiceLevel === level} className={`rounded-lg px-3 py-2 text-xs ${practiceLevel === level ? 'btn-brand' : 'btn-ghost'}`} onClick={() => { setPracticeLevel(level); if (level !== 'All' && category === 'full_mock') setCategory('all'); }}>{level}</button>)}</div></div>
        <div className="flex flex-wrap gap-2" aria-label="Exam category">{(['all', 'full_mock', 'listening', 'reading', 'writing', 'speaking'] as const).map((value) => <button key={value} type="button" aria-pressed={category === value} className={`rounded-lg px-3 py-2 text-xs capitalize ${category === value ? 'btn-brand' : 'btn-ghost'}`} onClick={() => { setCategory(value); if (value === 'full_mock') setPracticeLevel('All'); }}>{value === 'full_mock' ? 'Full Mock' : value === 'all' ? 'All skills' : value}</button>)}</div>
        <p className="text-xs text-white/50">A1–C1 describe practice content. Full Mock estimated results remain Below B1 / B1 / B2 / C1.</p>
      </div>}

      {!loading && (testsLoaded || mocksLoaded) && (
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="card rounded-2xl p-3 text-center">
            <p className="text-xl font-black text-white">{totalAssigned}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-white/40">assigned</p>
          </div>
          <div className="card rounded-2xl p-3 text-center">
            <p className="text-xl font-black text-white">{totalQuestions}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-white/40">questions</p>
          </div>
          <div className="card rounded-2xl p-3 text-center">
            <p className="text-xl font-black text-brand">{readyCount}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-white/40">ready</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="mt-4 space-y-3" aria-label="Loading exams">
          {[0, 1].map((i) => (
            <div key={i} className="card animate-pulse rounded-2xl p-5">
              <div className="h-4 w-1/2 rounded bg-white/10" />
              <div className="mt-2 h-3 w-1/4 rounded bg-white/5" />
            </div>
          ))}
        </div>
      )}

      {!loading && (testsError || mocksError) && (
        <div className="mt-4 space-y-3" role="alert">
          {testsError && (
            <SourceErrorCard
              source="Tests"
              detail={testsError}
              onRetry={retry}
            />
          )}
          {mocksError && (
            <SourceErrorCard
              source="Mock exams"
              detail={mocksError}
              onRetry={retry}
            />
          )}
        </div>
      )}

      {!!program && !loading && !testsError && !mocksError && allMocks.length === 0 && (
        <div className="card mt-4 rounded-2xl p-6 text-center">
          <p className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-xl">🎯</p>
          <p className="mt-3 text-sm font-semibold text-white">{program === 'MULTILEVEL' && (practiceLevel !== 'All' || category !== 'all') ? 'No exams match these filters' : 'No exams available yet'}</p>
          <p className="mx-auto mt-1 max-w-70 text-xs text-white/40">
            New tests and mock exams appear here automatically once an admin creates them. The list refreshes every 30s and when you return to this window.
          </p>
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
                  className="card animate-rise group rounded-2xl p-5 transition hover:border-brand/25"
                  style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${TYPE_STYLE[t.type] ?? "bg-white/10 text-white/70 ring-white/20"}`}
                        >
                          {t.type}
                        </span>
                        {(program === 'MULTILEVEL' ? t.practiceLevel : t.level) && (
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60 ring-1 ring-white/10">
                            {program === 'MULTILEVEL' ? `Practice ${t.practiceLevel}` : t.level}
                          </span>
                        )}
                        {t.isDemo && (
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60 ring-1 ring-white/10">
                            demo
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 truncate text-base font-bold text-white">{t.title}</p>
                      <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-white/40">
                        {t.durationMinutes != null && <span>⏱ {t.durationMinutes} min</span>}
                        <span>❓ {t.questionCount} questions</span>
                      </p>
                      {t.sections?.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1">
                          {t.sections.map((s) => (
                            <span
                              key={s}
                              className="rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-white/50 ring-1 ring-white/10"
                            >
                              {s}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => void handleStartTest(t)}
                      disabled={startingId !== null || empty}
                      className="btn-brand shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-50"
                    >
                      {startingId === t.id ? "Starting…" : empty ? "Empty" : "Start →"}
                    </button>
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
              return (
                <li
                  key={`mock-${m.id}`}
                  className="card animate-rise group rounded-2xl p-5 transition hover:border-violet-400/25"
                  style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${TYPE_STYLE[m.type] ?? "bg-white/10 text-white/70 ring-white/20"}`}>
                          {m.type === "multilevel" ? "multilevel" : "ielts"}
                        </span>
                        {(program === 'MULTILEVEL' ? m.practiceLevel : m.level) && (
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60 ring-1 ring-white/10">
                            {program === 'MULTILEVEL' ? `Practice ${m.practiceLevel}` : m.level}
                          </span>
                        )}
                        {m.isDemo && (
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60 ring-1 ring-white/10">
                            demo
                          </span>
                        )}
                        <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200 ring-1 ring-violet-400/20">
                          mock
                        </span>
                      </div>
                      <p className="mt-1.5 truncate text-base font-bold text-white" title={m.title}>
                        {m.title}
                      </p>
                      <p className="text-[11px] text-white/45">{mockType}</p>
                      <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-white/40">
                        {m.durationMinutes != null && <span>⏱ {m.durationMinutes} min</span>}
                        <span>❓ {m.questionCount} questions</span>
                        {m.skills.length > 0 && <span>· {m.skills.join(" · ")}</span>}
                      </p>
                      {m.description && (
                        <p className="mt-1 line-clamp-2 text-[11px] text-white/30">{m.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">Mock</p>
                      <p className="mt-1 text-[11px] text-white/40">{empty ? "Empty" : `${m.questionCount} Q`}</p>
                    </div>
                  </div>
                  {empty && (
                    <p className="mt-2 text-[11px] text-amber-300/80">This mock has no questions yet — it will be available after an admin adds content.</p>
                  )}
                  {!empty && (m.access === "granted" || m.isDemo) && (
                    <div className="mt-3 flex gap-2">
                      {(["practice", "timed"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => void handleStartMock(m, mode)}
                          disabled={startingId !== null}
                          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold capitalize transition disabled:opacity-50 ${
                            mode === "timed"
                              ? "bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/40 hover:bg-violet-500/30"
                              : "btn-brand"
                          }`}
                        >
                          {startingId === `mock:${m.id}` ? "Starting…" : mode === "timed" ? "⏱ Timed" : "Start →"}
                        </button>
                      ))}
                    </div>
                  )}
                  {!empty && m.access === "pending" && (
                    <p className="mt-2 text-[11px] text-amber-300/80">
                      Admin tasdig‘ini kuting — bu mock hali ochilmagan.
                      <span className="block text-white/40">Waiting for admin confirmation before you can start this mock.</span>
                    </p>
                  )}
                  {!empty && m.access === "locked" && (
                    <p className="mt-2 text-[11px] text-white/30">
                      Bu mock sotuvda — admin bilan bog‘laning.
                      <span className="block text-white/25">This mock needs a purchase — ask your admin.</span>
                    </p>
                  )}
                </li>
              );
            }
          })}
        </ul>
      )}

      {startError && (
        <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {startError}
        </p>
      )}
    </section>
  );
}

/**
 * Actionable per-source failure card: what failed, why (status/code), which
 * backend was contacted, and a manual retry. A failed source must never be
 * mistaken for "no exams assigned".
 */
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
    <div className="card rounded-2xl border border-red-500/30 p-5">
      <p className="text-sm font-medium text-red-300">Could not load {source}</p>
      <p className="mt-1 text-xs text-white/60">{detail}</p>
      <p className="mt-1 break-all font-mono text-[11px] text-white/30">API: {API_BASE_URL}</p>
      <p className="mt-1 text-[11px] text-white/30">
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
