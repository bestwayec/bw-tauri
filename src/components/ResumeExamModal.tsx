import { useState, useEffect } from "react";
import { useSessionStore } from "@/lib/session-store";
import { getAttemptSession } from "@/lib/exam-sessions";
import { getTestAttemptSession } from "@/lib/tests";
import { readPendingAnswers, clearAttemptCache } from "@/lib/offline-exam";
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

export function isSessionExpired(session: ActiveExamSession, now = Date.now()): boolean {
  const deadline = getSessionDeadline(session);
  if (!deadline) return false;
  const parsed = Date.parse(deadline);
  return !Number.isNaN(parsed) && parsed <= now;
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

export type RecoveryServerStatus =
  | "checking"
  | "verified_active"
  | "already_submitted"
  | "expired"
  | "ownership_mismatch"
  | "not_found"
  | "offline_unverified";

export interface VerificationState {
  checking: boolean;
  serverStatus: RecoveryServerStatus;
  pendingAnswersCount: number;
  initialAnswersCount: number;
  deadlineText: string | null;
  canResume: boolean;
}

export default function ResumeExamModal({ onResume, onResumeTest, isExamActive }: Props) {
  const currentProfileId = useSessionStore((s) => s.profile?.id);
  const [session, setSession] = useState<ActiveExamSession | null>(() =>
    isExamActive ? null : getActiveExamSession(useSessionStore.getState().profile?.id),
  );
  const [dismissed, setDismissed] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [verification, setVerification] = useState<VerificationState>({
    checking: true,
    serverStatus: "checking",
    pendingAnswersCount: 0,
    initialAnswersCount: 0,
    deadlineText: null,
    canResume: false,
  });

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
    setVerification((prev) => ({
      ...prev,
      checking: true,
      serverStatus: "checking",
      canResume: false,
    }));

    const deadline = getSessionDeadline(session);
    let expired = isSessionExpired(session);
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
    const initialCount = Object.keys(savedMap).length;

    // Check offline pending answers from IndexedDB
    void readPendingAnswers(session.start.attemptId)
      .then(async (pending) => {
        if (cancelled) return;
        const pendingCount = pending.length;

        // When online, check server attempt status
        const online = typeof navigator === "undefined" || navigator.onLine !== false;
        if (online) {
          try {
            if (session.kind === "mock") {
              const serverAttempt = await getAttemptSession(session.start.attemptId);
              if (cancelled) return;

              if (serverAttempt === null) {
                // HTTP 404
                setVerification({
                  checking: false,
                  serverStatus: "not_found",
                  pendingAnswersCount: pendingCount,
                  initialAnswersCount: initialCount,
                  deadlineText: deadlineDesc,
                  canResume: false,
                });
                return;
              }

              // Validate ownership against server record
              if (
                serverAttempt.studentId &&
                currentProfileId &&
                serverAttempt.studentId !== currentProfileId
              ) {
                setVerification({
                  checking: false,
                  serverStatus: "ownership_mismatch",
                  pendingAnswersCount: pendingCount,
                  initialAnswersCount: initialCount,
                  deadlineText: deadlineDesc,
                  canResume: false,
                });
                return;
              }

              // Check if completed or grading
              if (serverAttempt.status === "completed" || serverAttempt.status === "grading") {
                clearActiveExamSession();
                setVerification({
                  checking: false,
                  serverStatus: "already_submitted",
                  pendingAnswersCount: pendingCount,
                  initialAnswersCount: initialCount,
                  deadlineText: deadlineDesc,
                  canResume: false,
                });
                return;
              }

              // Server-authoritative deadline check with server clock skew
              let serverExpired = expired;
              if (serverAttempt.deadlineAt && serverAttempt.serverTime) {
                const serverTimeMs = Date.parse(serverAttempt.serverTime);
                const deadlineMs = Date.parse(serverAttempt.deadlineAt);
                if (!Number.isNaN(serverTimeMs) && !Number.isNaN(deadlineMs)) {
                  const skew = serverTimeMs - Date.now();
                  const remainingMs = deadlineMs - (Date.now() + skew);
                  if (remainingMs <= 0) {
                    serverExpired = true;
                    deadlineDesc = "Muddati tugagan (Server Deadline Passed)";
                  } else {
                    serverExpired = false;
                    const mins = Math.max(1, Math.round(remainingMs / 60000));
                    deadlineDesc = `${mins} daqiqa qoldi (${mins}m remaining)`;
                  }
                }
              }

              if (serverExpired) {
                setVerification({
                  checking: false,
                  serverStatus: "expired",
                  pendingAnswersCount: pendingCount,
                  initialAnswersCount: initialCount,
                  deadlineText: deadlineDesc,
                  canResume: false,
                });
                return;
              }

              // Verified active mock attempt
              setVerification({
                checking: false,
                serverStatus: "verified_active",
                pendingAnswersCount: pendingCount,
                initialAnswersCount: initialCount,
                deadlineText: deadlineDesc,
                canResume: true,
              });
              return;
            } else {
              // Standard test verification
              const serverTest = await getTestAttemptSession(session.start.attemptId);
              if (cancelled) return;

              if (serverTest === null) {
                setVerification({
                  checking: false,
                  serverStatus: "not_found",
                  pendingAnswersCount: pendingCount,
                  initialAnswersCount: initialCount,
                  deadlineText: deadlineDesc,
                  canResume: false,
                });
                return;
              }

              if (
                serverTest.studentId &&
                currentProfileId &&
                serverTest.studentId !== currentProfileId
              ) {
                setVerification({
                  checking: false,
                  serverStatus: "ownership_mismatch",
                  pendingAnswersCount: pendingCount,
                  initialAnswersCount: initialCount,
                  deadlineText: deadlineDesc,
                  canResume: false,
                });
                return;
              }

              if (
                serverTest.status === "completed" ||
                serverTest.status === "grading" ||
                Boolean(serverTest.finishedAt)
              ) {
                clearActiveExamSession();
                setVerification({
                  checking: false,
                  serverStatus: "already_submitted",
                  pendingAnswersCount: pendingCount,
                  initialAnswersCount: initialCount,
                  deadlineText: deadlineDesc,
                  canResume: false,
                });
                return;
              }

              if (expired) {
                setVerification({
                  checking: false,
                  serverStatus: "expired",
                  pendingAnswersCount: pendingCount,
                  initialAnswersCount: initialCount,
                  deadlineText: deadlineDesc,
                  canResume: false,
                });
                return;
              }

              // Verified active standard test attempt
              setVerification({
                checking: false,
                serverStatus: "verified_active",
                pendingAnswersCount: pendingCount,
                initialAnswersCount: initialCount,
                deadlineText: deadlineDesc,
                canResume: true,
              });
              return;
            }
          } catch {
            /* Network unreachable or timeout -> treat server status as UNKNOWN (offline_unverified) */
          }
        }

        // Offline or server unreachable: Treat server as UNKNOWN, do not claim verified
        if (!cancelled) {
          setVerification({
            checking: false,
            serverStatus: expired ? "expired" : "offline_unverified",
            pendingAnswersCount: pendingCount,
            initialAnswersCount: initialCount,
            deadlineText: deadlineDesc,
            canResume: !expired,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVerification({
            checking: false,
            serverStatus: expired ? "expired" : "offline_unverified",
            pendingAnswersCount: 0,
            initialAnswersCount: initialCount,
            deadlineText: deadlineDesc,
            canResume: !expired,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session, currentProfileId]);

  if (!session || isExamActive || dismissed) return null;

  const isTest = session.kind === "test";
  const title = isTest ? session.test.title : session.mock.title;
  const subtitle = isTest ? "Standard / Practice Test" : "Full CBT Mock Exam";

  // Discard Confirmation Dialog (protects unsynchronized answers)
  if (showDiscardConfirm) {
    return (
      <div
        role="alertdialog"
        aria-label="Confirm Discard Session"
        className="fixed inset-0 z-[90] grid place-items-center bg-black/85 p-4 backdrop-blur-sm animate-fade-in"
      >
        <div className="card w-full max-w-md rounded-2xl border border-red-500/30 bg-[#0B0F17] p-6 shadow-2xl space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-lg">
              ⚠️
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                Seansni butunlay o'chirish
              </h3>
              <p className="text-xs text-red-400">
                Confirm session discard
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-3 text-xs text-slate-300 space-y-2">
            <p className="font-semibold text-red-300">
              Diqqat: Sinxronlanmagan ma'lumotlar yo'qolishi mumkin!
            </p>
            <p className="text-slate-400 leading-relaxed">
              {verification.pendingAnswersCount > 0
                ? `Ushbu imtihonda ${verification.pendingAnswersCount} ta serverga yuborilmagan javob mavjud. Agar seansni o'chirsangiz, bu javoblar qaytarib bo'lmaydigan darajada o'chib ketadi.`
                : "Ushbu seansni xotiradan butunlay o'chirmoqchimisiz? Uni keyinroq davom ettirib bo'lmaydi."}
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowDiscardConfirm(false)}
              className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              Orqaga (Cancel)
            </button>
            <button
              type="button"
              onClick={async () => {
                clearActiveExamSession();
                await clearAttemptCache(session.start.attemptId).catch(() => undefined);
                setShowDiscardConfirm(false);
                setSession(null);
              }}
              className="rounded-xl border border-red-500/30 bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 transition-colors shadow-lg shadow-red-950/40"
            >
              Ha, butunlay o'chirish (Delete)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Ownership mismatch state
  if (verification.serverStatus === "ownership_mismatch") {
    return (
      <div
        role="alertdialog"
        aria-label="Exam Ownership Mismatch"
        className="fixed inset-0 z-[85] grid place-items-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in"
      >
        <div className="card w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#0B0F17] p-6 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 text-lg">
              🔒
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                Foydalanuvchi mos kelmadi
              </h3>
              <p className="text-xs text-amber-400">
                Attempt belongs to another candidate
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-300 leading-relaxed">
            Ushbu imtihon seansi boshqa profilga tegishli ekanligi server tomonidan tasdiqlandi. Xavfsizlik yuzasidan boshqa nomzodning imtihonini davom ettirish taqiqlanadi.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              Keyinroq (Dismiss)
            </button>
            <button
              type="button"
              onClick={() => {
                clearActiveMockSession();
                setSession(null);
              }}
              className="btn-brand rounded-xl px-5 py-2 text-xs font-bold"
            >
              Tozalash (Clear)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Not found on server state
  if (verification.serverStatus === "not_found") {
    return (
      <div
        role="alertdialog"
        aria-label="Exam Not Found"
        className="fixed inset-0 z-[85] grid place-items-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in"
      >
        <div className="card w-full max-w-md rounded-2xl border border-slate-700 bg-[#0B0F17] p-6 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-lg">
              ❓
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                Imtihon serverda topilmadi
              </h3>
              <p className="text-xs text-slate-400">
                Attempt record not found on server
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-300 leading-relaxed">
            Server ma'lumotlar bazasida ushbu urinish ID si topilmadi. Ehtimol, u bekor qilingan yoki server yangilangan.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              Keyinroq (Dismiss)
            </button>
            <button
              type="button"
              onClick={() => {
                clearActiveMockSession();
                setSession(null);
              }}
              className="btn-brand rounded-xl px-5 py-2 text-xs font-bold"
            >
              Tozalash (Clear)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Already submitted state
  if (verification.serverStatus === "already_submitted") {
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
  if (verification.serverStatus === "expired") {
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
              onClick={() => setDismissed(true)}
              className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              Keyinroq (Dismiss)
            </button>
            <button
              type="button"
              onClick={() => setShowDiscardConfirm(true)}
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

          <div className="border-t border-slate-800 pt-2 space-y-1.5 text-[11px]">
            {/* Server Status Indicator */}
            {verification.checking ? (
              <p className="text-blue-400 flex items-center gap-1.5">
                <span className="animate-spin text-xs">⏳</span>
                <span>Server va sessiya holati tekshirilmoqda...</span>
              </p>
            ) : verification.serverStatus === "verified_active" ? (
              <p className="text-emerald-400 flex items-center gap-1.5 font-medium">
                <span>✓</span>
                <span>Server holati: Faol (Server-verified in progress)</span>
              </p>
            ) : (
              <p className="text-amber-400 flex items-center gap-1.5 font-medium">
                <span>⚠️</span>
                <span>Server holati: Noma'lum (Tarmoqqa ulanib bo'lmadi — Offline)</span>
              </p>
            )}

            {/* Offline Pending Answers */}
            {verification.pendingAnswersCount > 0 ? (
              <p className="text-amber-300 flex items-center gap-1.5 font-medium">
                <span>⚠️</span>
                <span>Mahalliy navbatda sinxronizatsiya kutilmoqda: <strong>{verification.pendingAnswersCount}</strong> ta javob</span>
              </p>
            ) : verification.serverStatus === "verified_active" ? (
              <p className="text-slate-400 flex items-center gap-1.5">
                <span className="text-emerald-400">✓</span>
                <span>Mahalliy navbatda sinxronlanmagan o'zgarishlar yo'q</span>
              </p>
            ) : (
              <p className="text-slate-400 flex items-center gap-1.5">
                <span className="text-amber-400">ℹ️</span>
                <span>Mahalliy navbat bo'sh, ammo server holati tasdiqlanmagan</span>
              </p>
            )}

            {verification.initialAnswersCount > 0 && (
              <p className="text-slate-500 text-[10px]">
                Boshlang'ich javoblar soni: {verification.initialAnswersCount} ta
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
            onClick={() => setDismissed(true)}
            className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            Keyinroq (Dismiss)
          </button>
          <button
            type="button"
            onClick={() => setShowDiscardConfirm(true)}
            className="rounded-xl border border-red-500/20 bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-900/40 transition-colors"
          >
            Bekor qilish (Discard)
          </button>
          <button
            type="button"
            disabled={verification.checking || !verification.canResume}
            onClick={() => {
              const active = session;
              setSession(null);
              if (active.kind === "test") {
                onResumeTest?.(active.test, active.start);
              } else {
                onResume(active.mock, active.start, active.chosen);
              }
            }}
            className={`rounded-xl px-5 py-2 text-xs font-bold transition-all ${
              verification.checking || !verification.canResume
                ? "bg-slate-700 text-slate-400 cursor-not-allowed opacity-60"
                : "btn-brand shadow-lg shadow-emerald-950/40"
            }`}
          >
            {verification.checking ? "Tekshirilmoqda..." : "Davom ettirish (Resume) →"}
          </button>
        </div>
      </div>
    </div>
  );
}
