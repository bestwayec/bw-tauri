import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useQueryClient } from '@tanstack/react-query';
// Route-split: heavy screens (three.js splash, exam runners) load on demand
// so the initial bundle stays lean on lab hardware.
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Exams = lazy(() => import("@/pages/Exams"));
const History = lazy(() => import("@/pages/History"));
const ExamTrack = lazy(() => import("@/pages/ExamTrack"));
const Profile = lazy(() => import("@/pages/Profile"));
const Settings = lazy(() => import("@/pages/Settings"));
const TestRunner = lazy(() => import("@/pages/TestRunner"));
const MockSectionPicker = lazy(() => import("@/pages/MockSectionPicker"));
const MockExam = lazy(() => import("@/pages/MockExam"));
const Locked = lazy(() => import("@/pages/Locked"));
const Result = lazy(() => import("@/pages/Result"));
const LiveProctoring = lazy(() => import("@/pages/LiveProctoring"));
const GradingQueue = lazy(() => import("@/pages/GradingQueue"));
const GroupsResults = lazy(() => import("@/pages/GroupsResults"));
const CenterOverview = lazy(() => import("@/pages/CenterOverview"));
const StudentResults = lazy(() => import("@/pages/StudentResults"));
const BootSplash = lazy(() => import("@/components/BootSplash"));
const Particles = lazy(() => import("@/components/Particles"));
import Sidebar, { MobileNavigation } from "@/components/Sidebar";
import TitleBar from "@/components/TitleBar";
import UpdateNotifier from "@/components/UpdateNotifier";
import ExitConfirmModal from "@/components/ExitConfirmModal";
import ReauthModal from "@/components/ReauthModal";
import { checkForUpdate, getDismissedVersion, type UpdateInfo } from "@/lib/version";
import ClickSpark from "@/components/ClickSpark";
import CrashRecovery from "@/components/CrashRecovery";
import { logout } from "@/lib/api";
import { isAdminRole, isStaffRole, isTeacherRole } from "@/lib/auth";
import { useSessionStore } from "@/lib/session-store";
import { tryTauriInvoke } from "@/hooks/useLockdown";
import { usePrograms } from '@/lib/programs';
import type { StartResult, TestListItem } from "@/lib/tests";
import { targetSectionOf } from "@/lib/mocks";
import type {
  MockExamListItem,
  MockShapedSection,
  MockSkill,
  MockStartResult,
  MockSubmitResult,
} from "@/lib/mocks";

export type Route =
  | "login"
  | "dashboard"
  | "exams"
  | "history"
  | "examTrack"
  | "profile"
  | "settings"
  | "runner"
  | "mockSections"
  | "mockRunner"
  | "locked"
  | "result"
  | "proctoring"
  | "grading"
  | "groups"
  | "centerOverview"
  | "studentResults";

export interface Student {
  id: string;
  name: string | null;
  phone: string | null;
  role?: string;
}

const TITLES: Record<Exclude<Route, "login">, string> = {
  dashboard: "Dashboard",
  exams: "Exams",
  history: "History",
  examTrack: "Exam Track",
  profile: "Profile",
  settings: "Settings",
  runner: "Exam runner",
  mockSections: "Choose section",
  mockRunner: "Mock runner",
  locked: "Locked",
  result: "Result",
  proctoring: "Live Proctoring",
  grading: "Grading Queue",
  groups: "Groups & Results",
  centerOverview: "Center Overview",
  studentResults: "Student Results",
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
        className={`h-2 w-2 rounded-full ${online ? "bg-[#10B981] shadow-[0_0_8px_#10B981]" : "bg-red-400"}`}
      />
      {online ? "Online" : "Offline"}
    </span>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const programs = usePrograms();
  const [route, setRoute] = useState<Route>("login");
  const [student, setStudent] = useState<Student | null>(null);
  const [, setRestoring] = useState(true);
  const [activeTest, setActiveTest] = useState<TestListItem | null>(null);
  const [activeStart, setActiveStart] = useState<StartResult | null>(null);
  const [lastScore, setLastScore] = useState<{ autoScore: number | null } | null>(null);
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
  const cachedStudent = useRef<string | null>(null);
  useEffect(() => { setStats(null); }, [programs.data?.activeProgram]);
  useEffect(() => {
    const id = student?.id ?? null;
    if (cachedStudent.current === id) return;
    if (id === null) queryClient.clear();
    else queryClient.removeQueries({ predicate: (query) => query.queryKey[1] !== id });
    if (cachedStudent.current !== null) {
      setActiveTest(null); setActiveStart(null); setActiveMock(null); setActiveMockStart(null);
      setActiveMockSection(null); setLastMockResult(null); setLastScore(null); setStats(null);
    }
    cachedStudent.current = id;
  }, [student?.id, queryClient]);

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
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const updateChecked = useRef(false);
  const updateTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!student || updateChecked.current) return;
    updateChecked.current = true;
    updateTimer.current = window.setTimeout(() => {
      updateTimer.current = null;
      void (async () => {
        const info = await checkForUpdate();
        if (info && getDismissedVersion() !== info.latest) setUpdate(info);
      })();
    }, 3000);
  }, [student]);
  useEffect(
    () => () => {
      if (updateTimer.current != null) window.clearTimeout(updateTimer.current);
    },
    [],
  );

  useEffect(() => {
    let dead = false;
    const applySession = (status: string, profile: { id: string; name?: string | null; phone?: string | null; role?: string } | null) => {
      if (dead) return;
      if (status !== "ready" || !profile?.id) {
        if (status === "logged-out") {
          setStudent(null);
          setRoute("login");
        }
        setRestoring(false);
        return;
      }
      const role = profile.role || "student";
      setStudent({
        id: profile.id,
        name: typeof profile.name === "string" ? profile.name : null,
        phone: typeof profile.phone === "string" ? profile.phone : null,
        role,
      });
      setRoute((r) => {
        if (r === "login") {
          if (isTeacherRole(role)) return "proctoring";
          if (isAdminRole(role)) return "centerOverview";
          return "dashboard";
        }
        return r;
      });
      setRestoring(false);
    };
    const unsub = useSessionStore.subscribe((s) => applySession(s.status, s.profile));
    const cur = useSessionStore.getState();
    applySession(cur.status, cur.profile);
    void cur.initialize();
    return () => {
      dead = true;
      unsub();
    };
  }, []);

  const navigate = (next: Route) => setRoute(next);

  const [showReauth, setShowReauth] = useState(false);
  const routeRef = useRef<Route>("login");
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  useEffect(() => {
    const onReauth = () => {
      const r = routeRef.current;
      if (r === "runner" || r === "mockSections" || r === "mockRunner" || r === "locked") {
        setShowReauth(true);
      }
    };
    window.addEventListener("exam:reauth-required", onReauth);
    return () => window.removeEventListener("exam:reauth-required", onReauth);
  }, []);

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

  const handleStartMock = (mock: MockExamListItem, start: MockStartResult, chosen?: MockSkill) => {
    setActiveMock(mock);
    setActiveMockStart(start);
    const wanted = targetSectionOf(start, chosen);
    const section = wanted ? start.exam.sections.find((s) => s.skill === wanted) ?? null : null;
    setActiveMockSection(section);
    setLastMockResult(null);
    setLastScore(null);
    setRoute(section ? 'mockRunner' : 'mockSections');
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
    const role = s.role || "student";
    if (isTeacherRole(role)) setRoute("proctoring");
    else if (isAdminRole(role)) setRoute("centerOverview");
    else setRoute("dashboard");
  };

  // In Teacher / Instructor / Admin desktop mode:
  // Automatically DISABLE lockdown (no fullscreen kiosk, no WH_KEYBOARD_LL, multi-monitors allowed).
  const isPrivilegedRole = isStaffRole(student?.role);
  useEffect(() => {
    if (isPrivilegedRole) {
      void tryTauriInvoke("set_locked", { locked: false });
      if (typeof document !== "undefined" && document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    }
  }, [isPrivilegedRole]);

  const handleLogout = async () => {
    if (!confirm("Log out of Bestway Exam on this device?")) return;
    await logout().catch(() => undefined);
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
  };

  const activeRoute: Route = student ? route : "login";
  const examActive =
    activeRoute === "runner" ||
    activeRoute === "mockSections" ||
    activeRoute === "mockRunner" ||
    activeRoute === "locked";
  const showChrome = student !== null && !examActive;
  const resultMax = activeStart
    ? activeStart.questions.reduce((s, q) => s + (q.maxScore ?? 0), 0)
    : null;

  if (activeRoute === "login") {
    return (
      <>
        <div className="flex flex-col h-screen overflow-hidden bg-bg text-white">
          <TitleBar examActive={false} />
          <div className="relative flex-1 overflow-y-auto">
            {!reduceMotion && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-85 [mask-image:radial-gradient(ellipse_85%_75%_at_50%_45%,black_30%,transparent_100%)]"
            >
              <Suspense fallback={null}>
                <Particles
                  particleCount={220}
                  particleSpread={10}
                  speed={0.15}
                  particleColors={["#10B981", "#34D399", "#059669"]}
                  alphaParticles
                  particleBaseSize={150}
                  sizeRandomness={0.8}
                  cameraDistance={20}
                />
              </Suspense>
            </div>
          )}
          <main className="relative flex min-h-full items-center justify-center p-6">
            <div className="w-full max-w-md">
              <Suspense fallback={null}>
                <Login onLogin={handleLogin} />
              </Suspense>
            </div>
          </main>
          </div>
        </div>
        {showSplash && (
          <Suspense fallback={null}>
            <BootSplash exiting={introLeaving} />
          </Suspense>
        )}
        <CrashRecovery />
      </>
    );
  }

  return (
    <>
    <div className="flex flex-col h-screen overflow-hidden">
      <TitleBar examActive={examActive} />
      <div className="app-bg app-grid flex flex-1 min-h-0 overflow-hidden text-white">
      {showChrome && (
        <Sidebar
          route={activeRoute}
          role={student?.role}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          onNavigate={navigate}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {showChrome && (
          <div className="flex shrink-0 items-center gap-3 border-b border-emerald-500/15 bg-[#0B0F17]/90 px-6 py-3 backdrop-blur-xl 2xl:px-10">
            <p className="text-[11px] text-white/35">
              Bestway Exam <span className="mx-1 text-white/20">/</span>{" "}
              <span className="font-semibold text-white/75">{TITLES[activeRoute]}</span>
            </p>
            <div className="ml-auto">
              <OnlineDot />
            </div>
          </div>
        )}
        {showChrome && <MobileNavigation route={activeRoute} role={student?.role} onNavigate={navigate} />}

        {examActive ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col">
                <Suspense fallback={null}>
                  {activeRoute === "runner" && activeTest && activeStart && (
                    <TestRunner
                      test={activeTest}
                      start={activeStart}
                      studentName={student?.name ?? null}
                      onExit={handleExitExam}
                      onFinish={handleFinishExam}
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
                  {activeRoute === "mockRunner" && activeMockStart && activeMockSection && (
                    <MockExam
                      key={`${activeMockStart.attemptId}:${activeMockSection.skill}`}
                      start={activeMockStart}
                      section={activeMockSection}
                      studentName={student?.name ?? null}
                      onExit={handleExitExam}
                      onBackToSections={() => navigate("mockSections")}
                      onFinish={handleFinishMock}
                      onAdvance={(next) => { setActiveMockStart(next); setActiveMockSection(next.exam.sections.find((s) => s.skill === next.currentSkill) ?? null); }}
                    />
                  )}
                  {activeRoute === "locked" && <Locked onBack={handleBackToExams} />}
                </Suspense>
              </div>
            </main>
          </div>
        ) : (
          <ClickSpark sparkColor="#10B981" sparkSize={10} sparkRadius={22} sparkCount={8} duration={420} className="flex min-h-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6 2xl:px-10">
            <motion.div
              key={activeRoute + (activeRoute === "result" ? historyKey : "")}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <Suspense fallback={null}>
              {activeRoute === "dashboard" && (
                <Dashboard
                  studentName={student?.name ?? null}
                  onNavigate={navigate}
                  onStart={handleStartExam}
                  onStartMock={handleStartMock}
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
              {activeRoute === "examTrack" && <ExamTrack onBrowse={() => navigate('exams')} />}
              {activeRoute === "proctoring" && <LiveProctoring />}
              {activeRoute === "grading" && <GradingQueue />}
              {activeRoute === "groups" && <GroupsResults />}
              {activeRoute === "centerOverview" && <CenterOverview onNavigate={navigate} />}
              {activeRoute === "studentResults" && <StudentResults />}
              {activeRoute === "profile" && (
                <Profile
                  name={student?.name ?? null}
                  phone={student?.phone ?? null}
                  role={student?.role}
                  stats={stats}
                  onLogout={() => void handleLogout()}
                />
              )}
              {activeRoute === "settings" && (
                <Settings
                  studentName={student?.name ?? null}
                  studentPhone={student?.phone ?? null}
                  role={student?.role}
                  onLogout={() => void handleLogout()}
                />
              )}
              {activeRoute === "result" && (
                <Result
                  testTitle={activeMock?.title ?? activeTest?.title ?? null}
                  testType={activeTest?.type ?? null}
                  autoScore={lastScore?.autoScore ?? null}
                  maxScore={resultMax}
                  attemptId={lastMockResult ? (activeMockStart?.attemptId ?? null) : (activeStart?.attemptId ?? null)}
                  mock={
                    lastMockResult
                      ? {
                          ...lastMockResult,
                          examType: activeMockStart?.exam.type ?? activeMock?.type,
                        }
                      : null
                  }
                  onBack={lastMockResult ? () => navigate("mockSections") : handleBackToExams}
                  onHistory={() => navigate("history")}
                />
              )}
              </Suspense>
            </motion.div>
          </main>
          </ClickSpark>
        )}
      </div>
    </div>
    </div>
    {update && <UpdateNotifier update={update} onClose={() => setUpdate(null)} deferInstall={examActive} />}
    {showSplash && (
      <Suspense fallback={null}>
        <BootSplash exiting={introLeaving} />
      </Suspense>
    )}
    <ExitConfirmModal open={showExitConfirm} onCancel={handleCancelExit} onConfirm={handleConfirmExit} />
    <ReauthModal open={showReauth} phone={student?.phone ?? null} onDone={() => setShowReauth(false)} />
    <CrashRecovery />
    </>
  );
}
