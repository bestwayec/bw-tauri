import { afterEach, describe, expect, it, vi } from 'vitest';

function indexedStore() {
  const data = new Map<IDBValidKey, Blob>();
  vi.stubGlobal('indexedDB', { open: () => {
    const request: Record<string, unknown> = {};
    request.result = { close() {}, transaction() {
      const tx: Record<string, unknown> = {};
      tx.objectStore = () => ({
        put(blob: Blob, key: IDBValidKey) { data.set(key, blob); return { result: key }; },
        get(key: IDBValidKey) { return { result: data.get(key) }; },
        delete(key: IDBValidKey) { data.delete(key); return { result: undefined }; },
        getAllKeys() { return { result: [...data.keys()] }; },
      });
      queueMicrotask(() => (tx.oncomplete as () => void)?.());
      return tx;
    } };
    queueMicrotask(() => (request.onsuccess as () => void)?.());
    return request;
  } });
  return data;
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('completed recording recovery', () => {
  it('retains a take and blocks finalization when IndexedDB is unavailable', async () => {
    const recordings = await import('./durable-recordings');
    vi.stubGlobal('indexedDB', { open() { throw new Error('disk unavailable'); } });
    const blob = new Blob(['synthetic recording']);
    await expect(recordings.retainRecording('failed:q', blob)).rejects.toThrow('disk unavailable');
    expect(await recordings.hasPendingRecordings('failed')).toBe(true);
    expect(await recordings.recoverRecording('failed:q')).toBe(blob);
    indexedStore();
    await recordings.releaseRecording('failed:q');
    expect(await recordings.hasPendingRecordings('failed')).toBe(false);
  });
  it('recovers after page-module reload and deletes only the acknowledged take', async () => {
    const data = indexedStore();
    let recordings = await import('./durable-recordings');
    const blob = new Blob(['synthetic recording']);
    await recordings.retainRecording('resume:q', blob);
    await recordings.retainRecording('other:q', blob);
    vi.resetModules(); recordings = await import('./durable-recordings');
    expect(await recordings.recoverRecording('resume:q')).toBe(blob);
    await recordings.releaseRecording('resume:q');
    expect(data.has('resume:q')).toBe(false);
    expect(await recordings.hasPendingRecordings('other')).toBe(true);
    await recordings.releaseRecording('other:q');
  });
  it('rejects empty takes before storing or treating them as pending', async () => {
    const data = indexedStore();
    const recordings = await import('./durable-recordings');
    await expect(recordings.retainRecording('empty:q', new Blob())).rejects.toThrow('empty');
    expect(data.size).toBe(0);
    expect(await recordings.hasPendingRecordings('empty')).toBe(false);
  });
});
