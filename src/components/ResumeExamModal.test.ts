import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  getActiveMockSession,
  getActiveExamSession,
  persistActiveMockSession,
  persistActiveTestSession,
  clearActiveMockSession,
  ACTIVE_MOCK_SESSION_KEY,
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

it('expires cached sessions older than 4 hours', () => {
  const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
  const expired = JSON.stringify({
    kind: 'mock',
    studentId: 'student-a',
    mock: { id: 'exam-expired', title: 'Old' },
    start: { attemptId: 'att-old' },
    at: fiveHoursAgo,
  });
  localStorage.setItem(ACTIVE_MOCK_SESSION_KEY, expired);
  expect(getActiveExamSession('student-a')).toBeNull();
  expect(localStorage.getItem(ACTIVE_MOCK_SESSION_KEY)).toBeNull();
});

it('clears active session cleanly', () => {
  persistActiveMockSession({ id: 'exam-3' } as MockExamListItem, { attemptId: 'attempt-3' } as MockStartResult);
  expect(getActiveExamSession('student-a')).not.toBeNull();
  clearActiveMockSession();
  expect(getActiveExamSession('student-a')).toBeNull();
});
