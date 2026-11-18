import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  getActiveMockSession,
  getActiveExamSession,
  persistActiveMockSession,
  persistActiveTestSession,
  clearActiveMockSession,
  getSessionDeadline,
  isSessionExpired,
  ACTIVE_MOCK_SESSION_KEY,
  type ActiveExamSession,
  type ActiveTestSession,
} from './ResumeExamModal';
import { useSessionStore } from '@/lib/session-store';
import type { MockExamListItem, MockStartResult } from '@/lib/mocks';
import type { TestListItem, StartResult } from '@/lib/tests';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  useSessionStore.setState({ profile: { id: 'student-a' } });
});
afterEach(() => vi.unstubAllGlobals());

it('offers a cached attempt only to its owning student', () => {
  persistActiveMockSession({ id: 'exam', title: 'IELTS Mock' } as MockExamListItem, { attemptId: 'attempt' } as MockStartResult, 'writing');
  expect(getActiveMockSession()?.studentId).toBe('student-a');
  useSessionStore.setState({ profile: { id: 'student-b' } });
  expect(getActiveMockSession()).toBeNull();
  useSessionStore.setState({ profile: { id: 'student-a' } });
  expect(getActiveMockSession()?.start.attemptId).toBe('attempt');
});

it('does not trust or destroy a legacy cache with no owner', () => {
  const legacy = JSON.stringify({ mock: { id: 'exam' }, start: { attemptId: 'attempt' }, at: Date.now() });
  localStorage.setItem(ACTIVE_MOCK_SESSION_KEY, legacy);
  expect(getActiveMockSession()).toBeNull();
  expect(localStorage.getItem(ACTIVE_MOCK_SESSION_KEY)).toBe(legacy);
});

it('persists and restores active test sessions for single-section/practice tests', () => {
  persistActiveTestSession(
    { id: 'test-1', title: 'Listening Practice Part 1' } as TestListItem,
    { attemptId: 'attempt-t1' } as StartResult,
  );
  const session = getActiveExamSession();
  expect(session?.kind).toBe('test');
  if (session?.kind === 'test') {
    expect(session.test.title).toBe('Listening Practice Part 1');
    expect(session.start.attemptId).toBe('attempt-t1');
  }
});

it('resolves active session reactively when owner id is passed explicitly', () => {
  persistActiveTestSession(
    { id: 'test-2', title: 'Reading Test' } as TestListItem,
    { attemptId: 'attempt-r1' } as StartResult,
  );
  // When store is booting and profile is temporarily null:
  useSessionStore.setState({ profile: null });
  expect(getActiveExamSession()).toBeNull();

  // Passing explicit resolved ownerId (e.g. from reactive hook):
  const resolved = getActiveExamSession('student-a');
  expect(resolved).not.toBeNull();
  expect(resolved?.studentId).toBe('student-a');
});

it('preserves cached sessions on read without destructive silent deletion', () => {
  const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
  const sessionData = JSON.stringify({
    kind: 'mock',
    studentId: 'student-a',
    mock: { id: 'exam-5h', title: 'Session 5h ago' },
    start: { attemptId: 'att-5h' },
    at: fiveHoursAgo,
  });
  localStorage.setItem(ACTIVE_MOCK_SESSION_KEY, sessionData);
  // getActiveExamSession preserves the session rather than deleting it destructively
  const retrieved = getActiveExamSession('student-a');
  expect(retrieved).not.toBeNull();
  expect(retrieved?.start.attemptId).toBe('att-5h');
  expect(localStorage.getItem(ACTIVE_MOCK_SESSION_KEY)).toBe(sessionData);
});

it('clears active session cleanly when explicitly instructed', () => {
  persistActiveMockSession({ id: 'exam-3' } as MockExamListItem, { attemptId: 'attempt-3' } as MockStartResult);
  expect(getActiveExamSession('student-a')).not.toBeNull();
  clearActiveMockSession();
  expect(getActiveExamSession('student-a')).toBeNull();
});

it('detects session deadline and evaluates expiration correctly', () => {
  const futureIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const pastIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const activeSession: ActiveExamSession = {
    kind: 'mock',
    studentId: 'student-a',
    mock: { id: 'exam-future', title: 'Future' } as MockExamListItem,
    start: { attemptId: 'att-future', deadlineAt: futureIso } as MockStartResult,
    at: Date.now(),
  };

  const expiredSession: ActiveExamSession = {
    kind: 'mock',
    studentId: 'student-a',
    mock: { id: 'exam-past', title: 'Past' } as MockExamListItem,
    start: { attemptId: 'att-past', deadlineAt: pastIso } as MockStartResult,
    at: Date.now(),
  };

  expect(getSessionDeadline(activeSession)).toBe(futureIso);
  expect(isSessionExpired(activeSession)).toBe(false);

  expect(getSessionDeadline(expiredSession)).toBe(pastIso);
  expect(isSessionExpired(expiredSession)).toBe(true);
});

it('prioritizes section deadlines for scoped mock exams', () => {
  const sectionDeadlineIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const overallDeadlineIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const scopedSession: ActiveExamSession = {
    kind: 'mock',
    studentId: 'student-a',
    mock: { id: 'exam-scoped', title: 'Scoped' } as MockExamListItem,
    start: {
      attemptId: 'att-scoped',
      overallDeadlineAt: overallDeadlineIso,
      sectionDeadlines: { writing: sectionDeadlineIso },
    } as unknown as MockStartResult,
    chosen: 'writing',
    at: Date.now(),
  };

  expect(getSessionDeadline(scopedSession)).toBe(sectionDeadlineIso);
  expect(isSessionExpired(scopedSession)).toBe(false);
});

it('calculates deadline for standard tests using durationMinutes and startedAt', () => {
  const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 mins ago
  const testSession: ActiveTestSession = {
    kind: 'test',
    studentId: 'student-a',
    test: { id: 't-timed', title: 'Timed Test' } as TestListItem,
    start: {
      attemptId: 'att-timed',
      resumed: false,
      durationMinutes: 30, // 30 min duration -> 20 min left
      startedAt,
      questions: [],
    },
    at: Date.now(),
  };

  const deadline = getSessionDeadline(testSession);
  expect(deadline).not.toBeNull();
  expect(isSessionExpired(testSession)).toBe(false);

  // If started 40 mins ago with 30 min duration:
  const oldStartedAt = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  const expiredTestSession: ActiveTestSession = {
    ...testSession,
    start: { ...testSession.start, startedAt: oldStartedAt },
  };
  expect(isSessionExpired(expiredTestSession)).toBe(true);
});
