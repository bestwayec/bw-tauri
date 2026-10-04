import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { get, patch } from './api';
import { getPrograms, programQueryKey, refreshProgramContext, selectProgram, type ProgramState } from './programs';
import { matchesCatalogue } from './catalogue';
import { useSessionStore } from './session-store';
import { ExamTracks } from '@/components/ExamTracks';

vi.mock('./api', () => ({ get: vi.fn(), patch: vi.fn(), API_BASE_URL: 'https://api.example.test/v1' }));

// Zustand v5 exposes getInitialState() as the SSR snapshot, so renderToStaticMarkup
// cannot observe runtime setState and the program query would stay disabled. Provide a
// ready session snapshot so the seeded server state renders. Test scaffolding only.
vi.mock('./session-store', () => {
  let current: { status: string; profile: { id: string } | null } = { status: 'ready', profile: { id: 'student-1' } };
  const hook = Object.assign(
    (selector: (state: typeof current) => unknown) => selector(current),
    {
      getState: () => current,
      getInitialState: () => current,
      setState: (partial: Partial<typeof current>) => { current = { ...current, ...partial }; },
      subscribe: () => () => {},
    },
  );
  return { useSessionStore: hook };
});

const state: ProgramState = { activeProgram: 'MULTILEVEL', availablePrograms: ['IELTS', 'MULTILEVEL'], accessPolicy: 'SELF_SELECT' };
beforeEach(() => { vi.clearAllMocks(); useSessionStore.setState({ status: 'ready', profile: { id: 'student-1' } }); });
afterEach(() => { useSessionStore.setState({ status: 'logged-out', profile: null }); });

describe('server-owned desktop exam context', () => {
  it('uses only the authenticated own-track endpoint and reads persisted server state after reload', async () => {
    vi.mocked(patch).mockResolvedValueOnce(state);
    vi.mocked(get).mockResolvedValueOnce(state);
    expect(await selectProgram('MULTILEVEL')).toEqual(state);
    expect(patch).toHaveBeenLastCalledWith('/exam-programs/mine', { program: 'MULTILEVEL' });
    expect(await getPrograms()).toEqual(state);
    expect(get).toHaveBeenLastCalledWith('/exam-programs/mine');
  });
  it('rejects malformed backend program state instead of falling back to IELTS', async () => {
    vi.mocked(get).mockResolvedValueOnce({ ...state, activeProgram: 'INVENTED' });
    await expect(getPrograms()).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
  });
  it('keeps programme cache identities separate across switches and students', () => {
    expect(programQueryKey('tests', 'student-1', 'IELTS')).not.toEqual(programQueryKey('tests', 'student-1', 'MULTILEVEL'));
    expect(programQueryKey('tests', 'student-1', 'IELTS')).not.toEqual(programQueryKey('tests', 'student-2', 'IELTS'));
  });
  it('removes old catalogue, history and assessment data while retaining attempt-owned recovery data', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    for (const resource of ['tests', 'my-attempts', 'mock-exams', 'mock-assessment-history', 'assessment']) client.setQueryData(programQueryKey(resource, 'student-1', 'IELTS'), ['old IELTS data']);
    client.setQueryData(['attempt-recovery', 'student-1', 'attempt-1'], ['saved answers']);
    const revalidate = vi.fn(async () => {});
    await refreshProgramContext(client, 'student-1', state, revalidate);
    expect(client.getQueryData(['exam-programs', 'student-1'])).toEqual(state);
    expect(client.getQueryData(programQueryKey('tests', 'student-1', 'IELTS'))).toBeUndefined();
    expect(client.getQueryData(programQueryKey('mock-assessment-history', 'student-1', 'IELTS'))).toBeUndefined();
    expect(client.getQueryData(['attempt-recovery', 'student-1', 'attempt-1'])).toEqual(['saved answers']);
    expect(revalidate).toHaveBeenCalledOnce();
    client.clear();
  });
  it('shows SELF_SELECT switch actions with the active track disabled and no locked enrollment message', () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.setQueryData(['exam-programs', 'student-1'], state);
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><ExamTracks /></QueryClientProvider>);
    // Both exam programs are visible and the server-confirmed active track is rendered.
    expect(html).toContain('IELTS'); expect(html).toContain('Multilevel');
    expect(html).toContain('Switch to IELTS'); expect(html).toContain('ACTIVE');
    expect(html).not.toContain('Locked'); expect(html).not.toContain('Staff assignment required');
    // The active track is disabled; the selectable switch action is enabled.
    expect(html).toContain('aria-pressed="true" disabled=""');
    expect(html).toContain('aria-pressed="false"');
    client.clear();
  });
  it('keeps staff-controlled unavailable tracks visibly disabled', () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.setQueryData(['exam-programs', 'student-1'], { activeProgram: 'IELTS', availablePrograms: ['IELTS'], accessPolicy: 'STAFF_ASSIGNED' });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><ExamTracks /></QueryClientProvider>);
    expect(html).toContain('IELTS'); expect(html).toContain('Multilevel');
    expect(html).toContain('Staff assignment required'); expect(html).not.toContain('Switch to Multilevel');
    client.clear();
  });
  it('renders a loading state before the server program state resolves', () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><ExamTracks /></QueryClientProvider>);
    expect(html).toContain('Loading tracks');
    client.clear();
  });
});

describe('desktop program and practice catalogue isolation', () => {
  const practice = { type: 'multilevel', profile: 'practice', practiceLevel: 'A1' as const, skills: ['reading'] };
  const full = { type: 'multilevel', profile: 'full_mock', practiceLevel: null, skills: ['reading', 'listening'] };
  it('includes Academic and General only under IELTS without applying Multilevel practice filters', () => {
    for (const type of ['ielts', 'ielts_academic', 'ielts_general']) expect(matchesCatalogue({ type }, 'IELTS', 'A1', 'full_mock')).toBe(true);
    expect(matchesCatalogue(practice, 'IELTS', 'All', 'all')).toBe(false);
    expect(matchesCatalogue({ type: 'ielts_general' }, 'MULTILEVEL', 'All', 'all')).toBe(false);
  });
  it('filters normalized A1–C1 practice levels without inventing official A1/A2 results', () => {
    expect(matchesCatalogue(practice, 'MULTILEVEL', 'A1', 'reading')).toBe(true);
    expect(matchesCatalogue(practice, 'MULTILEVEL', 'A2', 'all')).toBe(false);
    expect(matchesCatalogue(full, 'MULTILEVEL', 'A1', 'all')).toBe(false);
    expect(matchesCatalogue(full, 'MULTILEVEL', 'All', 'full_mock')).toBe(true);
    expect(matchesCatalogue(practice, 'MULTILEVEL', 'All', 'full_mock')).toBe(false);
  });
  it('does not infer practice level from legacy metadata or question types', () => {
    expect(matchesCatalogue({ type: 'multilevel', sections: ['reading'] }, 'MULTILEVEL', 'B1', 'reading')).toBe(false);
    expect(matchesCatalogue({ type: 'multilevel', sections: ['reading'] }, 'MULTILEVEL', 'All', 'reading')).toBe(true);
  });
});
