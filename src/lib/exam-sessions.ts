/**
 * Modernized exam session client aligning with /mock/attempts/* contracts.
 * Replaces obsolete unmapped /exam-sessions/* paths.
 */
import { get, post } from "./api";
import type { MockAttemptStatus } from "./mocks";

export interface ExamAttemptSession {
  attemptId: string;
  examId: string;
  studentId: string;
  status: MockAttemptStatus;
  startedAt: string;
  deadlineAt: string | null;
  serverTime: string;
}

/** Fetch active mock attempt details for the given attempt ID. */
export async function getAttemptSession(attemptId: string): Promise<ExamAttemptSession | null> {
  try {
    return await get<ExamAttemptSession>(`/mock/attempts/${encodeURIComponent(attemptId)}`);
  } catch (err: unknown) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Submit the student's mock attempt session. */
export function submitAttemptSession(
  attemptId: string,
  skills?: string[],
): Promise<{ status: MockAttemptStatus }> {
  return post<{ status: MockAttemptStatus }>(
    `/mock/attempts/${encodeURIComponent(attemptId)}/submit`,
    skills && skills.length > 0 ? { skills } : {},
  );
}

/** Flag an anomalous event or focus-loss during lockdown. */
export function flagAttemptAnomaly(
  attemptId: string,
  event: string,
): Promise<{ saved: boolean }> {
  return post<{ saved: boolean }>(
    `/mock/attempts/${encodeURIComponent(attemptId)}/flag-cheat`,
    { event },
  );
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { status?: number }).status === 404
  );
}

