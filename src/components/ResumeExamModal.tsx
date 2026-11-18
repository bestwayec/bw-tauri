import { useState, useEffect } from "react";
import { useSessionStore } from "@/lib/session-store";
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

export default function ResumeExamModal({ onResume, onResumeTest, isExamActive }: Props) {
  const [session, setSession] = useState<ActiveExamSession | null>(null);
  const currentProfileId = useSessionStore((s) => s.profile?.id);

  useEffect(() => {
    if (isExamActive || !currentProfileId) {
      if (isExamActive) setSession(null);
      return;
    }
    const found = getActiveExamSession(currentProfileId);
    setSession(found);
  }, [isExamActive, currentProfileId]);

  if (!session || isExamActive) return null;

  const isTest = session.kind === "test";
  const title = isTest ? session.test.title : session.mock.title;
  const subtitle = isTest ? "Standard / Practice Test" : "Full CBT Mock Exam";

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

        <div className="mt-4 rounded-xl border border-emerald-500/15 bg-[#111827] p-3.5 text-xs text-slate-300 space-y-1.5">
          <p className="font-semibold text-emerald-300">
            {title}
          </p>
          <p className="text-slate-400 leading-relaxed">
            Ilova yopilishidan oldingi imtihon seansi topildi. Barcha belgilangan javoblaringiz xavfsiz saqlangan. Qolgan vaqtingiz bilan to'xtagan joyingizdan davom etasizmi?
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
