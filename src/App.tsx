import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Exams from "@/pages/Exams";
import History from "@/pages/History";
import Profile from "@/pages/Profile";
import Runner from "@/pages/Runner";
import MockSectionPicker from "@/pages/MockSectionPicker";
import MockRunner from "@/pages/MockRunner";
import Locked from "@/pages/Locked";
import Result from "@/pages/Result";
import Sidebar from "@/components/Sidebar";
import BootSplash from "@/components/BootSplash";
import Particles from "@/components/Particles";
import UpdateNotifier from "@/components/UpdateNotifier";
import ExitConfirmModal from "@/components/ExitConfirmModal";
import { checkForUpdate, getDismissedVersion, type UpdateInfo } from "@/lib/version";
import ClickSpark from "@/components/ClickSpark";
import { clearSession, getAccessToken, getRefreshToken, initSecureSession, logout, me, refresh } from "@/lib/api";
import type { StartResult, TestListItem } from "@/lib/tests";
import type {
  MockExamListItem,
  MockShapedSection,
  MockStartResult,
  MockSubmitResult,
} from "@/lib/mocks";

export type Route =
  | "login"
  | "dashboard"
  | "exams"
  | "history"
  | "profile"
  | "runner"
  | "mockSections"
  | "mockRunner"
  | "locked"
  | "result";

export interface Student {
  id: string;
  name: string | null;
  phone: string | null;
}

const TITLES: Record<Exclude<Route, "login">, string> = {
  dashboard: "Dashboard",
  exams: "Exams",
  history: "History",
  profile: "Profile",
  runner: "Exam runner",
  mockSections: "Choose section",
  mockRunner: "Mock runner",
  locked: "Locked",
  result: "Result",
};

function OnlineDot() {
  const [online, setOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-white/45">
      <span
        className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400 shadow-[0_0_8px_#38c765]" : "bg-red-400"}`}
      />
      {online ? "Online" : "Offline"}
    </span>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>("login");
  const [student, setStudent] = useState<Student | null>(null);
  // Session-restore flag: written by the restore effect, intentionally NOT
  // used for rendering — the intro is timer-driven so slow networks never
  // hold the splash on screen.
  const [, setRestoring] = useState(true);
  const [activeTest, setActiveTest] = useState<TestListItem | null>(null);
  const [activeStart, setActiveStart] = useState<StartResult | null>(null);
  const [lastScore, setLastScore] = useState<{ autoScore: number | null } | null>(null);
  // Mock (IELTS) section-by-section flow — parallel to the legacy tests flow.
  const [activeMock, setActiveMock] = useState<MockExamListItem | null>(null);
  const [activeMockStart, setActiveMockStart] = useState<MockStartResult | null>(null);
  const [activeMockSection, setActiveMockSection] = useState<MockShapedSection | null>(null);
  const [lastMockResult, setLastMockResult] = useState<(MockSubmitResult & { skill: MockShapedSection["skill"] }) | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stats, setStats] = useState<{
    attempts: number;
    completed: number;
    avgScore: number | null;
  } | null>(null);
  // Fixed 2.5s brand intro (presentational only — timer-driven, never tied
  // to `restoring` or network speed). The real UI renders underneath from the
  // first frame; the splash exits at 2.2s and unmounts at exactly 2.5s.
  const [introLeaving, setIntroLeaving] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const leaveAt = reduce ? 150 : 2200;
    const goneAt = reduce ? 350 : 2500;
    const t1 = window.setTimeout(() => setIntroLeaving(true), leaveAt);
    const t2 = window.setTimeout(() => setIntroDone(true), goneAt);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  const showSplash = !introDone;
  // Particles backdrop renders on the login page only; skipped for reduced motion.
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  // Update toast: checked once per login, a beat after the intro finishes.
  // Silent on failure — a failed check must never disturb the student.
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const updateChecked = useRef(false);
  useEffect(() => {
    if (!student || updateChecked.current) return;
    updateChecked.current = true;
    const t = window.setTimeout(() => {
      void (async () => {
        const info = await checkForUpdate();
        if (info && getDismissedVersion() !== info.latest) setUpdate(info);
      })();
    }, 3000);
    return () => window.clearTimeout(t);
  }, [student]);

  // Restore persisted session (api.ts stores tokens AES-GCM encrypted in localStorage).
  // Without this, every reload forced re-login even with valid tokens.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        await initSecureSession();
        if (!(await getAccessToken()) && (await getRefreshToken())) {
          try {
            await refresh();
          } catch {
            await clearSession();
          }
        }
        if (await getAccessToken()) {
          const profile = await me();
          if (!dead) {
            if (profile?.user?.role === "student" && profile.user.id) {
              setStudent({
                id: profile.user.id,
                name: typeof profile.user.name === "string" ? profile.user.name : null,
                phone: typeof profile.user.phone === "string" ? profile.user.phone : null,
              });
              setRoute("dashboard");
            } else {
              await clearSession();
            }
          }
        }
      } catch {
        // Offline / expired — stay on login; request() already tried refresh.
        try {
          if (!(await getAccessToken())) await clearSession();
        } catch {
          /* ignore */
        }
      } finally {
        if (!dead) setRestoring(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const navigate = (next: Route) => setRoute(next);

  const handleStartExam = (test: TestListItem, start: StartResult) => {
    setActiveTest(test);
    setActiveStart(start);
    setLastScore(null);
    setRoute("runner");
  };

  const handleFinishExam = (score: { autoScore: number | null }) => {
    setLastScore(score);
    setLastMockResult(null);
    setHistoryKey((k) => k + 1);
    setRoute("result");
  };

  const handleStartMock = (mock: MockExamListItem, start: MockStartResult) => {
    setActiveMock(mock);
    setActiveMockStart(start);
    setActiveMockSection(null);
    setLastMockResult(null);
    setLastScore(null);
    setRoute("mockSections");
  };

  const handleFinishMock = (result: MockSubmitResult) => {
    if (!activeMockSection) return;
    setLastMockResult({ ...result, skill: activeMockSection.skill });
    setLastScore(null);
    setHistoryKey((k) => k + 1);
    setRoute("result");
  };

  const handleBackToExams = () => {
    setActiveTest(null);
    setActiveStart(null);
    setActiveMock(null);
    setActiveMockStart(null);
    setActiveMockSection(null);
    setRoute("exams");
  };

  const handleExitExam = () => {
    setShowExitConfirm(true);
  };
  const handleConfirmExit = () => {
    setShowExitConfirm(false);
    handleBackToExams();
  };
  const handleCancelExit = () => {
    setShowExitConfirm(false);
  };

  const handleLogin = (s: Student) => {
    setStudent(s);
    setRoute("dashboard");
  };

  const handleLogout = async () => {
    if (!confirm("Log out of Bestway Exam on this device?")) return;
    try {
      await logout();
    } finally {
      await clearSession();
      setStudent(null);
      setActiveTest(null);
      setActiveStart(null);
      setActiveMock(null);
      setActiveMockStart(null);
      setActiveMockSection(null);
      setLastMockResult(null);
      setStats(null);
      setUpdate(null);
      setRoute("login");
    }
  };

  // Student-only gate: force login when unauthenticated.
  const activeRoute: Route = student ? route : "login";
  // Focused exam screens hide the sidebar + topbar so lockdown stays distraction-free.
  const examActive =
    activeRoute === "runner" ||
    activeRoute === "mockSections" ||
    activeRoute === "mockRunner" ||
    activeRoute === "locked";
  const showChrome = student !== null && !examActive;
  const resultMax = activeStart
    ? activeStart.questions.reduce((s, q) => s + (q.maxScore ?? 0), 0)
    : null;

  // Auth screen: full-window, no sidebar.
  // NOTE: rendered immediately (even while `restoring` is still in flight) so
  // the timed intro reveals the real app in under a second. When restore
  // completes with a valid session, this flips to the dashboard by itself.
  if (activeRoute === "login") {
    return (
      <>
        <div className="relative h-screen overflow-y-auto bg-[#050807] text-white">
          {!reduceMotion && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-85 [mask-image:radial-gradient(ellipse_85%_75%_at_50%_45%,black_30%,transparent_100%)]"
            >
              <Particles
                particleCount={220}
                particleSpread={10}
                speed={0.15}
                particleColors={["#f7e37c", "#eed154", "#d9b73c"]}
                alphaParticles
                particleBaseSize={150}
                sizeRandomness={0.8}
                cameraDistance={20}
              />
            </div>
          )}
          <main className="relative flex min-h-full items-center justify-center p-6">
            <div className="w-full max-w-md">
              <Login onLogin={handleLogin} />
            </div>
          </main>
        </div>
        {showSplash && <BootSplash exiting={introLeaving} />}
      </>
    );
  }

  return (
    <>
    <div className="app-bg app-grid flex h-screen overflow-hidden text-white">
      {showChrome && (
        <Sidebar
          route={activeRoute}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          onNavigate={navigate}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {showChrome && (
          <div className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-black/50 px-6 py-3 backdrop-blur-xl 2xl:px-10">
            <p className="text-[11px] text-white/35">
              Bestway Exam <span className="mx-1 text-white/20">/</span>{" "}
              <span className="font-semibold text-white/75">{TITLES[activeRoute]}</span>
            </p>
            <div className="ml-auto">
              <OnlineDot />
            </div>
          </div>
        )}

        <ClickSpark sparkColor="#38c765" sparkSize={10} sparkRadius={22} sparkCount={8} duration={420} className="flex min-h-0 flex-1 flex-col">
          <main
            className={
              examActive
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6 2xl:px-10"
            }
          >
            <motion.div
              key={activeRoute + (activeRoute === "result" ? historyKey : "")}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={examActive ? "flex min-h-0 flex-1 flex-col" : undefined}
            >
              {activeRoute === "dashboard" && (
                <Dashboard
                  studentName={student?.name ?? null}
                  onNavigate={navigate}
                  onStart={handleStartExam}
                />
              )}
              {activeRoute === "exams" && (
                <Exams
                  studentName={student?.name ?? null}
                  onStart={handleStartExam}
                  onStartMock={handleStartMock}
                />
              )}
              {activeRoute === "history" && (
                <History refreshKey={historyKey} onStats={setStats} />
              )}
              {activeRoute === "profile" && (
                <Profile
                  name={student?.name ?? null}
                  phone={student?.phone ?? null}
                  stats={stats}
                  onLogout={() => void handleLogout()}
                />
              )}
              {activeRoute === "runner" && activeTest && activeStart && (
                <Runner
                  test={activeTest}
                  start={activeStart}
                  onLocked={() => navigate("locked")}
                  onExit={handleExitExam}
                  onFinish={handleFinishExam}
                />
              )}
              {activeRoute === "runner" && (!activeTest || !activeStart) && (
                <Exams
                  studentName={student?.name ?? null}
                  onStart={handleStartExam}
                  onStartMock={handleStartMock}
                />
              )}
              {activeRoute === "mockSections" && activeMockStart && (
                <MockSectionPicker
                  start={activeMockStart}
                  onPick={(section) => {
                    setActiveMockSection(section);
                    navigate("mockRunner");
                  }}
                  onBack={handleBackToExams}
                />
              )}
              {activeRoute === "mockSections" && !activeMockStart && (
                <Exams
                  studentName={student?.name ?? null}
                  onStart={handleStartExam}
                  onStartMock={handleStartMock}
                />
              )}
              {activeRoute === "mockRunner" && activeMockStart && activeMockSection && (
                <MockRunner
                  start={activeMockStart}
                  section={activeMockSection}
                  onExit={handleExitExam}
                  onBackToSections={() => navigate("mockSections")}
                  onFinish={handleFinishMock}
                />
              )}
              {activeRoute === "mockRunner" && (!activeMockStart || !activeMockSection) && (
                <Exams
                  studentName={student?.name ?? null}
                  onStart={handleStartExam}
                  onStartMock={handleStartMock}
                />
              )}
              {activeRoute === "locked" && <Locked onBack={handleBackToExams} />}
              {activeRoute === "result" && (
                <Result
                  testTitle={activeMock?.title ?? activeTest?.title ?? null}
                  autoScore={lastScore?.autoScore ?? null}
                  maxScore={resultMax}
                  attemptId={lastMockResult ? null : (activeStart?.attemptId ?? null)}
                  mock={
                    lastMockResult
                      ? {
                          skill: lastMockResult.skill,
                          status: lastMockResult.status,
                          sectionBands: lastMockResult.sectionBands,
                          overallBand: lastMockResult.overallBand,
                          cefrLevel: lastMockResult.cefrLevel,
                        }
                      : null
                  }
                  onBack={lastMockResult ? () => navigate("mockSections") : handleBackToExams}
                  onHistory={() => navigate("history")}
                />
              )}
            </motion.div>
          </main>
        </ClickSpark>
      </div>
    </div>
    {update && <UpdateNotifier update={update} onClose={() => setUpdate(null)} />}
    {showSplash && <BootSplash exiting={introLeaving} />}
    <ExitConfirmModal open={showExitConfirm} onCancel={handleCancelExit} onConfirm={handleConfirmExit} />
    </>
  );
}
