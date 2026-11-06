import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { getActiveMockSession, persistActiveMockSession, ACTIVE_MOCK_SESSION_KEY } from './ResumeExamModal';
import { useSessionStore } from '@/lib/session-store';
import type { MockExamListItem, MockStartResult } from '@/lib/mocks';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  useSessionStore.setState({ profile: { id: 'student-a' } });
});
afterEach(() => vi.unstubAllGlobals());

it('offers a cached attempt only to its owning student', () => {
  persistActiveMockSession({ id: 'exam' } as MockExamListItem, { attemptId: 'attempt' } as MockStartResult, 'writing');
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
