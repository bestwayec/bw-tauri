import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
  };
}

async function freshModule() {
  vi.resetModules();
  return await import('./offline-exam');
}

const startPayload = {
  attemptId: 'matt-1',
  mode: 'practice',
  sections: [
    {
      skill: 'writing',
      groups: [
        {
          id: 'g-1',
          passageText: 'Task 1 prompt text',
          audioUrl: null,
          questions: [{ id: 'q-1', number: 1, type: 'essay_task1', prompt: 'Describe the chart.' }],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('indexedDB', undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('offline exam cache', () => {
  it('caches the whole shaped exam and reads it back typed', async () => {
    const offline = await freshModule();
    expect(await offline.cacheExamPayload('matt-1', startPayload)).toBe(true);
    const cached = await offline.readCachedExam<typeof startPayload>('matt-1');
    expect(cached?.sections[0].groups[0].passageText).toBe('Task 1 prompt text');
    expect(cached?.sections[0].groups[0].questions[0].id).toBe('q-1');
    expect(await offline.readCachedExam('other-attempt')).toBeNull();
  });

  it('mirrors answers per question and resolves only acknowledged ids', async () => {
    const offline = await freshModule();
    await offline.cacheAnswer('matt-1', 'q-1', 'First draft answer');
    await offline.cacheAnswer('matt-1', 'q-2', 'Second answer');
    await offline.cacheAnswer('other', 'q-1', 'Another attempt');
    expect(await offline.pendingAnswerCount('matt-1')).toBe(2);

    expect(await offline.resolvePendingAnswers('matt-1', ['q-1'])).toBe(1);
    expect(await offline.pendingAnswerCount('matt-1')).toBe(1);
    // The acknowledged answer is gone, the other attempt is untouched.
    expect(await offline.pendingAnswerCount('other')).toBe(1);
    // Unknown ids are ignored.
    expect(await offline.resolvePendingAnswers('matt-1', ['q-9'])).toBe(0);
  });

  it('reads the mirrored answers back for the runner to restore', async () => {
    const offline = await freshModule();
    await offline.cacheAnswer('matt-1', 'q-2', 'Second');
    await offline.cacheAnswer('matt-1', 'q-1', 'First');
    await offline.cacheAnswer('other', 'q-3', 'Elsewhere');
    const pending = await offline.readPendingAnswers('matt-1');
    expect(pending.map((item: { questionId: string }) => item.questionId).sort()).toEqual(['q-1', 'q-2']);
    expect(pending.find((item: { questionId: string }) => item.questionId === 'q-1')?.response).toBe('First');
    expect(await offline.readPendingAnswers('nothing-here')).toEqual([]);
  });

  it('caches remaining timer seconds and reads them back', async () => {
    const offline = await freshModule();
    expect(await offline.cacheTimerSeconds('matt-1', 1845)).toBe(true);
    expect(await offline.readCachedTimerSeconds('matt-1')).toBe(1845);
    expect(await offline.readCachedTimerSeconds('unknown-attempt')).toBeNull();
  });

  it('flushes pending offline answers in bulk and drops them from queue', async () => {
    const offline = await freshModule();
    await offline.cacheAnswer('matt-1', 'q-1', 'Answer A');
    await offline.cacheAnswer('matt-1', 'q-2', 'Answer B');
    expect(await offline.pendingAnswerCount('matt-1')).toBe(2);

    const received: Array<{ questionId: string; response: string }> = [];
    const count = await offline.flushOfflineSyncQueue('matt-1', async (payload: Array<{ questionId: string; response: string }>) => {
      received.push(...payload);
    });

    expect(count).toBe(2);
    expect(received.map((r) => r.questionId).sort()).toEqual(['q-1', 'q-2']);
    expect(await offline.pendingAnswerCount('matt-1')).toBe(0);
  });

  it('clears cached exam, mirrored answers, and timer for one attempt', async () => {
    const offline = await freshModule();
    await offline.cacheExamPayload('matt-1', startPayload);
    await offline.cacheAnswer('matt-1', 'q-1', 'answer');
    await offline.cacheTimerSeconds('matt-1', 1200);
    await offline.cacheExamPayload('matt-2', startPayload);
    await offline.clearAttemptCache('matt-1');
    expect(await offline.readCachedExam('matt-1')).toBeNull();
    expect(await offline.pendingAnswerCount('matt-1')).toBe(0);
    expect(await offline.readCachedTimerSeconds('matt-1')).toBeNull();
    expect(await offline.readCachedExam('matt-2')).not.toBeNull();
  });
});

describe('background answer sync worker', () => {
  it('flushes immediately, then every ten seconds, and stops on cleanup', async () => {
    vi.useFakeTimers();
    const offline = await freshModule();
    const flush = vi.fn(async () => {});
    const states: string[] = [];
    const stop = offline.startOfflineSync({ attemptId: 'matt-1', flush, onState: (s) => states.push(s) });

    await vi.advanceTimersByTimeAsync(0);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(states).toContain('synced');

    await vi.advanceTimersByTimeAsync(offline.OFFLINE_SYNC_INTERVAL_MS);
    expect(flush).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(offline.OFFLINE_SYNC_INTERVAL_MS * 3);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('reports pending when a flush fails online and offline when the network is down', async () => {
    vi.useFakeTimers();
    const offline = await freshModule();
    const flush = vi.fn(async () => {
      throw new Error('network down');
    });
    const states: string[] = [];
    const stop = offline.startOfflineSync({ attemptId: 'matt-1', flush, onState: (s) => states.push(s) });
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toContain('pending');

    const callsWhileOnline = flush.mock.calls.length;
    vi.stubGlobal('navigator', { onLine: false });
    await vi.advanceTimersByTimeAsync(offline.OFFLINE_SYNC_INTERVAL_MS);
    // Offline: the worker reports the state and skips the doomed request.
    expect(states).toContain('offline');
    expect(flush.mock.calls.length).toBe(callsWhileOnline);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    stop();
  });

  it('keeps answers without a server and never runs two flushes at once', async () => {
    vi.useFakeTimers();
    const offline = await freshModule();
    await offline.cacheAnswer('matt-1', 'q-1', 'stored offline');
    let release: () => void = () => {};
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const states: string[] = [];
    const stop = offline.startOfflineSync({ attemptId: 'matt-1', flush, onState: (s) => states.push(s) });
    await vi.advanceTimersByTimeAsync(0);
    // The first flush is still in flight, so the interval must not start a second.
    await vi.advanceTimersByTimeAsync(offline.OFFLINE_SYNC_INTERVAL_MS * 2);
    expect(flush).toHaveBeenCalledTimes(1);
    // Pending answers from before the worker started are reported.
    expect(states).toContain('pending');
    release();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(await offline.pendingAnswerCount('matt-1')).toBe(1);
  });
});
