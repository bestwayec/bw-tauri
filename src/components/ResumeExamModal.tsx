import { useState, useEffect } from "react";
import { useSessionStore } from "@/lib/session-store";
import { getAttemptSession } from "@/lib/exam-sessions";
import { readPendingAnswers } from "@/lib/offline-exam";
import type { MockExamListItem, MockStartResult, MockSkill } from "@/lib/mocks";
import type { TestListItem, StartResult } from "@/lib/tests";

export interface ActiveMockSession {
  kind?: "mock";
  studentId: string;
  mock: MockExamListItem;
  start: MockStartResult;
  chosen?: MockSkill;
  at: number;
}

export interface ActiveTestSession {
  kind: "test";
  studentId: string;
  test: TestListItem;
  start: StartResult;
  at: number;
}

export type ActiveExamSession = ActiveMockSession | ActiveTestSession;

export const ACTIVE_MOCK_SESSION_KEY = "bw_active_mock_session";

export function persistActiveMockSession(
  mock: MockExamListItem,
  start: MockStartResult,
  chosen?: MockSkill,
) {
  try {
    const studentId = useSessionStore.getState().profile?.id;
    if (!studentId) return;
    const session: ActiveMockSession = {
      kind: "mock",
      studentId,
      mock,
      start,
      chosen,
      at: Date.now(),
    };
    localStorage.setItem(ACTIVE_MOCK_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private storage fallback */
  }
}

export function persistActiveTestSession(
  test: TestListItem,
  start: StartResult,
) {
  try {
    const studentId = useSessionStore.getState().profile?.id;
    if (!studentId) return;
    const session: ActiveTestSession = {
      kind: "test",
      studentId,
      test,
      start,
      at: Date.now(),
    };
    localStorage.setItem(ACTIVE_MOCK_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private storage fallback */
  }
}

export function clearActiveMockSession() {
  try {
    localStorage.removeItem(ACTIVE_MOCK_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export const clearActiveExamSession = clearActiveMockSession;

export function getSessionDeadline(session: ActiveExamSession): string | null {
  if (session.kind === "test") {
    const rawDeadline = (session.start as { deadlineAt?: string | null }).deadlineAt;
    if (rawDeadline) return rawDeadline;
    if (session.start.durationMinutes && session.start.startedAt) {
      const startMs = Date.parse(session.start.startedAt);
      if (!Number.isNaN(startMs)) {
        return new Date(startMs + session.start.durationMinutes * 60_000).toISOString();
      }
    }
    return null;
  }
  const mockStart = session.start as MockStartResult;
  return (
    (session.chosen && mockStart.sectionDeadlines?.[session.chosen]) ??
    mockStart.overallDeadlineAt ??
    mockStart.deadlineAt ??
    null
  );
}

export function isSessionExpired(session: ActiveExamSession): boolean {
  const deadline = getSessionDeadline(session);
  if (!deadline) return false;
  const parsed = Date.parse(deadline);
  return !Number.isNaN(parsed) && parsed <= Date.now();
}

export function getActiveExamSession(explicitOwnerId?: string | null): ActiveExamSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_MOCK_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveExamSession>;
    const targetOwner = explicitOwnerId !== undefined ? explicitOwnerId : useSessionStore.getState().profile?.id;
    if (!parsed || !parsed.studentId || !targetOwner || parsed.studentId !== targetOwner) {
      return null;
    }

    // Session is valid for up to 4 hours (240 minutes)
    if (Date.now() - (parsed.at || 0) > 4 * 60 * 60 * 1000) {
      clearActiveMockSession();
      return null;
    }

    if (parsed.kind === "test") {
      const testSession = parsed as ActiveTestSession;
      if (!testSession.test?.id || !testSession.start?.attemptId) return null;
      return testSession;
    }

    // Default to mock session (includes legacy payloads without explicit kind)
    const mockSession = parsed as ActiveMockSession;
    if (!mockSession.mock?.id || !mockSession.start?.attemptId) return null;
    return { ...mockSession, kind: "mock" };
  } catch {
    return null;
  }
}

export function getActiveMockSession(): ActiveMockSession | null {
  const session = getActiveExamSession();
  if (session && session.kind !== "test") {
    return session as ActiveMockSession;
  }
  return null;
}

interface Props {
  onResume: (mock: MockExamListItem, start: MockStartResult, chosen?: MockSkill) => void;
  onResumeTest?: (test: TestListItem, start: StartResult) => void;
  isExamActive: boolean;
}

interface VerificationState {
  checking: boolean;
  isExpired: boolean;
  alreadySubmitted: boolean;
  syncedAnswersCount: number;
  pendingAnswersCount: number;
  deadlineText: string | null;
}

export default function ResumeExamModal({ onResume, onResumeTest, isExamActive }: Props) {
  const [session, setSession] = useState<ActiveExamSession | null>(null);
  const [verification, setVerification] = useState<VerificationState>({
    checking: true,
    isExpired: false,
    alreadySubmitted: false,
    syncedAnswersCount: 0,
    pendingAnswersCount: 0,
    deadlineText: null,
  });
  const currentProfileId = useSessionStore((s) => s.profile?.id);

  useEffect(() => {
    if (isExamActive || !currentProfileId) {
      if (isExamActive) setSession(null);
      return;
    }
    const found = getActiveExamSession(currentProfileId);
    setSession(found);
  }, [isExamActive, currentProfileId]);

  // Deep verification of the found session
  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    const deadline = getSessionDeadline(session);
    let expired = false;
    let deadlineDesc: string | null = null;

    if (deadline) {
      const parsed = Date.parse(deadline);
      if (!Number.isNaN(parsed)) {
        const diffMs = parsed - Date.now();
        if (diffMs <= 0) {
          expired = true;
          deadlineDesc = "Muddati tugagan (Expired)";
        } else {
          const mins = Math.max(1, Math.round(diffMs / 60000));
          deadlineDesc = `${mins} daqiqa qoldi (${mins}m remaining)`;
        }
      }
    }

    const savedMap = (session.start as { savedAnswers?: Record<string, string> }).savedAnswers ?? {};
    const syncedCount = Object.keys(savedMap).length;

    // Check offline pending answers
    void readPendingAnswers(session.start.attemptId)
      .then(async (pending) => {
        if (cancelled) return;
        const pendingCount = pending.length;

        // When online, check server status
        if (typeof navigator !== "undefined" && navigator.onLine && session.kind === "mock") {
          try {
            const serverAttempt = await getAttemptSession(session.start.attemptId);
            if (cancelled) return;
            if (serverAttempt) {
              if (serverAttempt.status === "completed" || serverAttempt.status === "grading") {
                clearActiveExamSession();
                setVerification({
                  checking: false,
                  isExpired: false,
                  alreadySubmitted: true,
                  syncedAnswersCount: syncedCount,
                  pendingAnswersCount: pendingCount,
                  deadlineText: deadlineDesc,
                });
                return;
              }
            }
          } catch {
            /* server unreachable, proceed with offline integrity data */
          }
        }

        if (!cancelled) {
          setVerification({
            checking: false,
            isExpired: expired,
            alreadySubmitted: false,
            syncedAnswersCount: syncedCount,
            pendingAnswersCount: pendingCount,
            deadlineText: deadlineDesc,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVerification({
            checking: false,
            isExpired: expired,
            alreadySubmitted: false,
            syncedAnswersCount: syncedCount,
            pendingAnswersCount: 0,
            deadlineText: deadlineDesc,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session || isExamActive) return null;

  const isTest = session.kind === "test";
  const title = isTest ? session.test.title : session.mock.title;
  const subtitle = isTest ? "Standard / Practice Test" : "Full CBT Mock Exam";

  // Already submitted state
  if (verification.alreadySubmitted) {
    return (
      <div
        role="alertdialog"
        aria-label="Exam Already Submitted"
        className="fixed inset-0 z-[85] grid place-items-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in"
      >
        <div className="card w-full max-w-md rounded-2xl border border-blue-500/30 bg-[#0B0F17] p-6 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 text-lg">
              ✓
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                Imtihon allaqachon topshirilgan
              </h3>
              <p className="text-xs text-slate-400">
                This attempt was already submitted ({subtitle})
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-300 leading-relaxed">
            Ushbu imtihon seansi serverda muvaffaqiyatli topshirilgan va yakunlangan. Siz uning baholash natijalarini natijalar bo'limida ko'rishingiz mumkin.
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => {
                clearActiveMockSession();
                setSession(null);
              }}
              className="btn-brand rounded-xl px-5 py-2 text-xs font-bold"
            >
              Tushunarli (Dismiss)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Expired attempt state
  if (verification.isExpired) {
    return (
      <div
        role="alertdialog"
        aria-label="Exam Deadline Expired"
        className="fixed inset-0 z-[85] grid place-items-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in"
      >
        <div className="card w-full max-w-md rounded-2xl border border-red-500/30 bg-[#0B0F17] p-6 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-lg">
              ⏰
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                Imtihon muddati tugagan
              </h3>
              <p className="text-xs text-red-400">
                Attempt deadline has passed ({subtitle})
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-red-500/15 bg-[#111827] p-3 text-xs text-slate-300 space-y-1">
            <p className="font-semibold text-red-300">{title}</p>
            <p className="text-slate-400 leading-relaxed">
              Ushbu imtihonning serverda belgilangan topshirish vaqti tugagan. Qolgan vaqt qolmaganligi sababli seansni davom ettirib bo'lmaydi.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                clearActiveMockSession();
                setSession(null);
              }}
              className="btn-brand rounded-xl px-5 py-2 text-xs font-bold"
            >
              Seansni tozalash (Discard Session)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label="Resume Unfinished Exam"
      className="fixed inset-0 z-[85] grid place-items-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in"
    >
      <div className="card w-full max-w-md rounded-2xl border border-emerald-500/30 bg-[#0B0F17] p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-lg">
            ⚡️
          </span>
          <div>
            <h3 className="text-base font-bold text-white">
              Imtihonni davom ettirish
            </h3>
            <p className="text-xs text-slate-400">
              Resume Unfinished CBT Session ({subtitle})
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-emerald-500/15 bg-[#111827] p-3.5 text-xs text-slate-300 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-emerald-300 truncate max-w-[240px]">
              {title}
            </p>
            {verification.deadlineText && (
              <span className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                {verification.deadlineText}
              </span>
            )}
          </div>

          <div className="border-t border-slate-800 pt-2 space-y-1 text-[11px]">
            <p className="text-slate-300 flex items-center gap-1.5">
              <span className="text-emerald-400">✓</span>
              <span>Serverda tasdiqlangan javoblar: <strong>{verification.syncedAnswersCount}</strong> ta</span>
            </p>
            {verification.pendingAnswersCount > 0 ? (
              <p className="text-amber-300 flex items-center gap-1.5 font-medium">
                <span>⚠️</span>
                <span>Mahalliy navbatda sinxronizatsiya kutilmoqda: <strong>{verification.pendingAnswersCount}</strong> ta</span>
              </p>
            ) : (
              <p className="text-slate-400 flex items-center gap-1.5">
                <span className="text-emerald-400">✓</span>
                <span>Barcha javoblar to'liq server bilan sinxronlangan</span>
              </p>
            )}
          </div>

          <p className="text-slate-400 text-[11px] leading-relaxed pt-1">
            Qolgan vaqtingiz bilan to'xtagan joyingizdan davom etasizmi?
          </p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              clearActiveMockSession();
              setSession(null);
            }}
            className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            Bekor qilish (Discard)
          </button>
          <button
            type="button"
            onClick={() => {
              const active = session;
              setSession(null);
              if (active.kind === "test") {
                onResumeTest?.(active.test, active.start);
              } else {
                onResume(active.mock, active.start, active.chosen);
              }
            }}
            className="btn-brand rounded-xl px-5 py-2 text-xs font-bold shadow-lg shadow-emerald-950/40"
          >
            Davom ettirish (Resume) →
          </button>
        </div>
      </div>
    </div>
  );
}
