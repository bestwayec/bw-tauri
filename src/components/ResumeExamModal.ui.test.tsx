import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ResumeExamModal, {
  persistActiveMockSession,
  persistActiveTestSession,
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
  useSessionStore.setState({ profile: { id: 'student-test' } });
});
afterEach(() => vi.unstubAllGlobals());

it('renders nothing when there is no active session', () => {
  const html = renderToStaticMarkup(
    <ResumeExamModal onResume={() => {}} isExamActive={false} />
  );
  expect(html).toBe('');
});

it('renders nothing when an exam is actively running', () => {
  persistActiveMockSession(
    { id: 'm1', title: 'IELTS Mock 1' } as MockExamListItem,
    { attemptId: 'att-1' } as MockStartResult
  );
  const html = renderToStaticMarkup(
    <ResumeExamModal onResume={() => {}} isExamActive={true} />
  );
  expect(html).toBe('');
});

it('initially renders with resume button disabled while verification is checking', () => {
  persistActiveMockSession(
    { id: 'm1', title: 'IELTS Mock 1' } as MockExamListItem,
    { attemptId: 'att-1' } as MockStartResult
  );
  const html = renderToStaticMarkup(
    <ResumeExamModal onResume={() => {}} isExamActive={false} />
  );
  expect(html).toContain('Tekshirilmoqda...');
  expect(html).toContain('disabled=""');
  expect(html).toContain('cursor-not-allowed');
  expect(html).toContain('IELTS Mock 1');
  expect(html).toContain('Full CBT Mock Exam');
});

it('supports and renders standard practice test attempts', () => {
  persistActiveTestSession(
    { id: 't-read', title: 'Reading Academic Test 1' } as TestListItem,
    { attemptId: 'att-t1', durationMinutes: 60, startedAt: new Date().toISOString() } as StartResult
  );
  const html = renderToStaticMarkup(
    <ResumeExamModal onResume={() => {}} isExamActive={false} />
  );
  expect(html).toContain('Reading Academic Test 1');
  expect(html).toContain('Standard / Practice Test');
  expect(html).toContain('Tekshirilmoqda...');
  expect(html).toContain('disabled=""');
});

it('does not leak attempts belonging to a different profile id', () => {
  persistActiveMockSession(
    { id: 'm1', title: 'IELTS Mock 1' } as MockExamListItem,
    { attemptId: 'att-1' } as MockStartResult
  );
  // Switch to another profile:
  useSessionStore.setState({ profile: { id: 'other-student' } });
  const html = renderToStaticMarkup(
    <ResumeExamModal onResume={() => {}} isExamActive={false} />
  );
  expect(html).toBe('');
});
