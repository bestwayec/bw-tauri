import { get, post } from "./api";

// TODO: backend `api-contract.md` must be updated first to match this contract.
// Planned endpoints (not yet implemented server-side):
//   GET  /exam-sessions/active?groupId=:groupId
//   GET  /exam-sessions/:id/roster
//   POST /exam-sessions/:id/lock-all
//   POST /exam-sessions/:id/unlock-all
//   POST /exam-sessions/:id/force-submit { userId? }
// If the backend ships different paths/shapes, update api-contract.md AND this file together.

export interface ExamSession {
  id: string;
  groupId: string;
  testId?: string;
  mockExamId?: string;
  locked: boolean;
  startedAt: string;
}

export interface RosterEntry {
  userId: string;
  name: string;
  online: boolean;
  locked: boolean;
  cheatCount: number;
  heartbeatAt: string;
}

/** Active (running) exam session for a group, or null when none is live. */
export async function getActiveSession(groupId: string): Promise<ExamSession | null> {
  try {
    return await get<ExamSession>("/exam-sessions/active", { groupId });
  } catch (err: unknown) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Live roster for an exam session (presence, lock state, cheat counts). */
export function getRoster(sessionId: string): Promise<RosterEntry[]> {
  return get<RosterEntry[]>(`/exam-sessions/${encodeURIComponent(sessionId)}/roster`);
}

/** Lock every participant in the session (admin control). */
export function lockAll(sessionId: string): Promise<void> {
  return post<void>(`/exam-sessions/${encodeURIComponent(sessionId)}/lock-all`, {});
}

/** Unlock every participant in the session (admin control). */
export function unlockAll(sessionId: string): Promise<void> {
  return post<void>(`/exam-sessions/${encodeURIComponent(sessionId)}/unlock-all`, {});
}

/**
 * Force-submit answers for the whole session, or a single user when `userId` is given.
 */
export function forceSubmit(sessionId: string, userId?: string): Promise<void> {
  return post<void>(`/exam-sessions/${encodeURIComponent(sessionId)}/force-submit`, {
    ...(userId ? { userId } : {}),
  });
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { status?: number }).status === 404
  );
}
