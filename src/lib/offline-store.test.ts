import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal in-memory Storage good enough for the store's usage. */
function fakeStorage(options: { failWrites?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.failWrites) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
  };
}

/** IndexedDB stub mirroring the shape the store uses (getAll/put/get/delete). */
function indexedStore() {
  const data = new Map<string, unknown>();
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: Record<string, unknown> = {};
      request.result = {
        close() {},
        transaction() {
          const tx: Record<string, unknown> = {};
          tx.objectStore = () => ({
            put(record: { key: string }, key: string) {
              data.set(key, record);
              return { result: key };
            },
            get: (key: string) => ({ result: data.get(key) }),
            delete(key: string) {
              data.delete(key);
              return { result: undefined };
            },
            getAll: () => ({ result: [...data.values()] }),
          });
          queueMicrotask(() => (tx.oncomplete as () => void)?.());
          return tx;
        },
      };
      queueMicrotask(() => (request.onsuccess as () => void)?.());
      return request;
    },
  });
  return data;
}

async function freshStore() {
  vi.resetModules();
  return await import('./offline-store');
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('offline store on the localStorage backend', () => {
  it('round-trips values, lists a namespace and deletes single keys', async () => {
    const store = await freshStore();
    vi.stubGlobal('indexedDB', undefined);
    expect(store.offlineStoreBackend()).toBe('localstorage');

    expect(await store.offlinePut('answers.matt-1', 'q-1', '{"response":"hives"}')).toBe(true);
    expect(await store.offlinePut('answers.matt-1', 'q-2', '{"response":"bees"}')).toBe(true);
    expect(await store.offlineGet('answers.matt-1', 'q-1')).toBe('{"response":"hives"}');
    expect(await store.offlineGet('answers.matt-1', 'missing')).toBeNull();

    const listed = await store.offlineList('answers.matt-1');
    expect(listed.map((entry) => entry.key).sort()).toEqual(['q-1', 'q-2']);

    expect(await store.offlineDelete('answers.matt-1', 'q-1')).toBe(true);
    expect(await store.offlineList('answers.matt-1')).toEqual([{ key: 'q-2', value: '{"response":"bees"}' }]);
  });

  it('keys are namespaced: the same key in two namespaces never collides', async () => {
    const store = await freshStore();
    vi.stubGlobal('indexedDB', undefined);
    await store.offlinePut('exam', 'attempt-1', 'full-payload');
    await store.offlinePut('answers.attempt-1', 'attempt-1', 'answer-value');
    expect(await store.offlineGet('exam', 'attempt-1')).toBe('full-payload');
    expect(await store.offlineGet('answers.attempt-1', 'attempt-1')).toBe('answer-value');
    expect(await store.offlineList('exam')).toEqual([{ key: 'attempt-1', value: 'full-payload' }]);
  });

  it('purges one namespace without touching another', async () => {
    const store = await freshStore();
    vi.stubGlobal('indexedDB', undefined);
    await store.offlinePut('answers.a', 'q-1', '1');
    await store.offlinePut('answers.b', 'q-1', '2');
    await store.offlinePurge('answers.a');
    expect(await store.offlineList('answers.a')).toEqual([]);
    expect(await store.offlineList('answers.b')).toEqual([{ key: 'q-1', value: '2' }]);
  });

  it('never throws when storage refuses writes', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ failWrites: true }));
    const store = await freshStore();
    vi.stubGlobal('indexedDB', undefined);
    expect(await store.offlinePut('exam', 'attempt-1', 'x')).toBe(false);
    expect(await store.offlineGet('exam', 'attempt-1')).toBeNull();
    expect(await store.offlineList('exam')).toEqual([]);
  });
});

describe('offline store backend selection', () => {
  it('uses IndexedDB when it exists and keeps working there', async () => {
    const data = indexedStore();
    const store = await freshStore();
    expect(store.offlineStoreBackend()).toBe('indexeddb');
    expect(await store.offlinePut('exam', 'attempt-1', '{"exam":true}')).toBe(true);
    expect(await store.offlineGet('exam', 'attempt-1')).toBe('{"exam":true}');
    expect(data.has('offline.exam.attempt-1')).toBe(true);
    expect(await store.offlineList('exam')).toEqual([{ key: 'attempt-1', value: '{"exam":true}' }]);
    await store.offlineDelete('exam', 'attempt-1');
    expect(await store.offlineGet('exam', 'attempt-1')).toBeNull();
    // No localStorage fallback was touched.
    expect((globalThis.localStorage as Storage).length).toBe(0);
  });

  it('falls back to memory when neither IndexedDB nor localStorage exists', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', undefined);
    const store = await freshStore();
    expect(store.offlineStoreBackend()).toBe('none');
    expect(await store.offlinePut('exam', 'attempt-1', 'value')).toBe(true);
    expect(await store.offlineGet('exam', 'attempt-1')).toBe('value');
    expect(await store.offlineList('exam')).toEqual([{ key: 'attempt-1', value: 'value' }]);
    await store.offlineDelete('exam', 'attempt-1');
    expect(await store.offlineGet('exam', 'attempt-1')).toBeNull();
  });
});
