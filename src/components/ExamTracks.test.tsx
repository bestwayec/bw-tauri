/**
 * Exam-track watchdog: a slow or broken programs API must never leave the
 * student on "Loading tracks…" forever. The waiting window is bounded at 5s and
 * then the IELTS / MULTILEVEL cards render from a safe default state.
 */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExamTracks, FALLBACK_PROGRAM_STATE, ProgramCards, TRACKS_TIMEOUT_MS, tracksView } from './ExamTracks';
import type { ProgramState } from '@/lib/programs';

// The SSR tests below seed TanStack Query cache, so the real hook is used by
// default and only overridden where a resolved-without-data state is asserted.
const override = vi.hoisted(() => ({ current: null as null | (() => unknown) }));

vi.mock('@/lib/programs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/programs')>();
  return {
    ...actual,
    usePrograms: (() => (override.current ? override.current() : actual.usePrograms())) as typeof actual.usePrograms,
  };
});

vi.mock('@/lib/session-store', () => {
  let current: { status: string; profile: { id: string } | null } = { status: 'ready', profile: { id: 'student-1' } };
  const hook = Object.assign((selector: (state: typeof current) => unknown) => selector(current), {
    getState: () => current,
    getInitialState: () => current,
    setState: (partial: Partial<typeof current>) => { current = { ...current, ...partial }; },
    subscribe: () => () => {},
    revalidate: async () => {},
  });
  return { useSessionStore: hook };
});

const serverState: ProgramState = {
  activeProgram: 'MULTILEVEL',
  availablePrograms: ['IELTS', 'MULTILEVEL'],
  accessPolicy: 'SELF_SELECT',
};

function clientWith(data?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  if (data !== undefined) client.setQueryData(['exam-programs', 'student-1'], data);
  return client;
}

function renderTracks(client: QueryClient) {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ExamTracks />
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}

function buttons(node: ReactNode): ReactElement<{ onClick: () => void; disabled?: boolean }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as ReactElement<{ onClick?: () => void; disabled?: boolean; children?: ReactNode }>;
    if (element.type === 'button') return [element as ReactElement<{ onClick: () => void; disabled?: boolean }>];
    return buttons(element.props.children);
  });
}

beforeEach(() => { override.current = null; });
afterEach(() => { override.current = null; });

describe('exam track loading watchdog', () => {
  it('bounds the wait at five seconds', () => {
    expect(TRACKS_TIMEOUT_MS).toBe(5000);
  });

  it('only shows the loading state while the request is in flight inside the window', () => {
    // Server answered → the real track state wins over any timeout.
    expect(tracksView({ isPending: false, data: serverState, timedOut: false })).toBe('data');
    expect(tracksView({ isPending: true, data: serverState, timedOut: true })).toBe('data');
    // Still waiting → keep the spinner.
    expect(tracksView({ isPending: true, data: undefined, timedOut: false })).toBe('loading');
    expect(tracksView({ isPending: true, data: null, timedOut: false })).toBe('loading');
    // Watchdog fired, or the request settled without data → default cards.
    expect(tracksView({ isPending: true, data: undefined, timedOut: true })).toBe('fallback');
    expect(tracksView({ isPending: false, data: undefined, timedOut: false })).toBe('fallback');
    expect(tracksView({ isPending: false, data: null, timedOut: true })).toBe('fallback');
  });

  it('renders the loading state before the request resolves', () => {
    const html = renderTracks(clientWith());
    expect(html).toContain('Loading tracks');
    expect(html).not.toContain('Switch to');
  });

  it('renders both default tracks plus a retry once the request settles without data', () => {
    const refetch = vi.fn();
    override.current = () => ({ isPending: false, data: undefined, refetch });
    const html = renderTracks(clientWith());
    expect(html).toContain('Could not load tracks');
    expect(html).toContain('IELTS');
    expect(html).toContain('Multilevel');
    expect(html).toContain('Switch to IELTS');
    expect(html).toContain('Switch to Multilevel');
    expect(html).toContain('Retry');
    // The fallback cards stay usable: no button carries the disabled attribute
    // (the `disabled:opacity-50` utility in the className is not a disabled button).
    expect(html).not.toContain('disabled=""');
  });

  it('still renders the server-confirmed track state when the request answers', () => {
    const html = renderTracks(clientWith(serverState));
    expect(html).toContain('ACTIVE');
    expect(html).toContain('Switch to IELTS');
    expect(html).not.toContain('Could not load tracks');
  });

  it('still keeps staff-controlled unavailable tracks disabled', () => {
    const html = renderTracks(clientWith({ activeProgram: 'IELTS', availablePrograms: ['IELTS'], accessPolicy: 'STAFF_ASSIGNED' }));
    expect(html).toContain('Staff assignment required');
    expect(html).not.toContain('Switch to Multilevel');
  });
});

describe('exam track fallback cards', () => {
  it('shows both programs and lets the student switch while the server is unreachable', () => {
    const onSelect = vi.fn();
    const tree = ProgramCards({ data: FALLBACK_PROGRAM_STATE, onSelect, pending: false });
    const html = renderToStaticMarkup(<ProgramCards data={FALLBACK_PROGRAM_STATE} onSelect={() => {}} pending={false} />);
    expect(html).toContain('Academic / General IELTS');
    expect(html).toContain('CEFR preparation');
    const [first, second] = buttons(tree);
    expect(first.props.disabled).toBeFalsy();
    expect(second.props.disabled).toBeFalsy();
    first.props.onClick();
    second.props.onClick();
    expect(onSelect.mock.calls).toEqual([['IELTS'], ['MULTILEVEL']]);
  });

  it('disables every track while a switch is being saved', () => {
    const tree = ProgramCards({ data: FALLBACK_PROGRAM_STATE, onSelect: () => {}, pending: true });
    expect(buttons(tree).map((b) => b.props.disabled)).toEqual([true, true]);
  });
});
