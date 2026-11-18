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
    expect(recordings.isRecordingDurable('failed:q')).toBe(false);
    expect(recordings.getRecordingDurability('failed:q')).toBe('memory_only');
    expect(recordings.hasUnpersistedRecordings('failed')).toBe(true);
    expect(await recordings.recoverRecording('failed:q')).toBe(blob);
    indexedStore();
    await recordings.releaseRecording('failed:q');
    expect(await recordings.hasPendingRecordings('failed')).toBe(false);
    expect(recordings.hasUnpersistedRecordings('failed')).toBe(false);
  });

  it('marks takes as durable when IndexedDB write succeeds', async () => {
    indexedStore();
    const recordings = await import('./durable-recordings');
    const blob = new Blob(['durable audio bytes']);
    await recordings.retainRecording('durable-att:q1', blob);
    expect(recordings.isRecordingDurable('durable-att:q1')).toBe(true);
    expect(recordings.getRecordingDurability('durable-att:q1')).toBe('durable');
    expect(recordings.hasUnpersistedRecordings('durable-att')).toBe(false);
    await recordings.releaseRecording('durable-att:q1');
    expect(recordings.getRecordingDurability('durable-att:q1')).toBe('unretained');
  });

  it('allows retrying persistence from memory when IndexedDB becomes available', async () => {
    const recordings = await import('./durable-recordings');
    vi.stubGlobal('indexedDB', { open() { throw new Error('disk quota exceeded'); } });
    const blob = new Blob(['retryable audio']);
    await expect(recordings.retainRecording('retry-att:q1', blob)).rejects.toThrow('disk quota exceeded');
    expect(recordings.isRecordingDurable('retry-att:q1')).toBe(false);
    expect(recordings.hasUnpersistedRecordings('retry-att')).toBe(true);

    // IndexedDB recovers
    const data = indexedStore();
    const retried = await recordings.retryPersistRecording('retry-att:q1');
    expect(retried).toBe(true);
    expect(recordings.isRecordingDurable('retry-att:q1')).toBe(true);
    expect(recordings.hasUnpersistedRecordings('retry-att')).toBe(false);
    expect(data.has('retry-att:q1')).toBe(true);
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
