import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.unstubAllGlobals(); });

it('atomically refuses to delete a newer IndexedDB answer snapshot', async () => {
  const store = await import('./offline-store');
  await store.offlinePut('answers.attempt', 'q', 'old');
  await store.offlinePut('answers.attempt', 'q', 'new');
  expect(await store.offlineDeleteIfValue('answers.attempt', 'q', 'old')).toBe(false);
  expect(await store.offlineGet('answers.attempt', 'q')).toBe('new');
  expect(await store.offlineDeleteIfValue('answers.attempt', 'q', 'new')).toBe(true);
  expect(await store.offlineGet('answers.attempt', 'q')).toBeNull();
});

it('keeps a newer IndexedDB draft while an older answer is acknowledged', async () => {
  const offline = await import('./offline-exam');
  await offline.cacheAnswer('attempt', 'q', 'old');
  await offline.flushOfflineSyncQueue('attempt', async () => {
    await offline.cacheAnswer('attempt', 'q', 'new');
  });
  expect(await offline.readPendingAnswers('attempt')).toEqual([
    expect.objectContaining({ questionId: 'q', response: 'new' }),
  ]);
});
