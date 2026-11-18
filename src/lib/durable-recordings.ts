/** Completed takes are retained until the backend acknowledges upload. */
const DB = 'bestway-recordings-v1';
const active = new Set<string>();

// Track in-memory blobs
const retained = new Map<string, Blob>();

// Explicit durability tracking: durable (persisted to IndexedDB) vs memory-only (failed disk persist)
const durableKeys = new Set<string>();
const memoryOnlyKeys = new Set<string>();

export type RecordingDurability = 'durable' | 'memory_only' | 'unretained';

export function markActiveRecording(key: string, busy: boolean) {
  if (busy) active.add(key);
  else active.delete(key);
}

export function hasActiveRecording(attempt: string) {
  return [...active].some((key) => key.startsWith(`${attempt}:`));
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('takes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('takes', mode);
    const request = run(tx.objectStore('takes'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const recordingKey = (attempt: string, question: string) => `${attempt}:${question}`;

/**
 * Retains a completed take. Attempts to persist to IndexedDB on disk.
 * If IndexedDB fails (e.g. disk full, quota exceeded, private mode),
 * the take is retained in volatile memory ONLY, marked as memory-only,
 * and the promise rejects so the caller is explicitly notified.
 * Memory-only takes are NEVER marked as durable.
 */
export async function retainRecording(key: string, blob: Blob): Promise<IDBValidKey> {
  if (!blob.size) return Promise.reject(new Error('The microphone produced an empty recording.'));
  retained.set(key, blob);
  try {
    const result = await operation('readwrite', (store) => store.put(blob, key));
    durableKeys.add(key);
    memoryOnlyKeys.delete(key);
    return result;
  } catch (err) {
    memoryOnlyKeys.add(key);
    durableKeys.delete(key);
    throw err;
  }
}

/**
 * Recovers a recording for the given key.
 * If the recording was in memory, returns it.
 * If recovered from IndexedDB, marks it as durable.
 */
export async function recoverRecording(key: string): Promise<Blob | undefined> {
  const inMemory = retained.get(key);
  if (inMemory) {
    return inMemory;
  }
  const blob = await operation('readonly', (store) => store.get(key));
  if (blob) {
    durableKeys.add(key);
    memoryOnlyKeys.delete(key);
  }
  return blob;
}

/**
 * Releases a recording after successful upload acknowledgement.
 * Removes from memory, IndexedDB, and durability tracking.
 */
export async function releaseRecording(key: string) {
  retained.delete(key);
  durableKeys.delete(key);
  memoryOnlyKeys.delete(key);
  try {
    await operation('readwrite', (store) => store.delete(key));
  } catch {
    /* store delete failure is non-fatal */
  }
}

/**
 * Checks if an attempt has any pending (unreleased) recordings either in RAM or on disk.
 */
export async function hasPendingRecordings(attempt: string): Promise<boolean> {
  if ([...retained.keys()].some((key) => key.startsWith(`${attempt}:`))) return true;
  try {
    const keys = await operation('readonly', (store) => store.getAllKeys());
    return keys.some((key) => String(key).startsWith(`${attempt}:`));
  } catch {
    throw new Error('Local recording storage could not be checked. Retry before submitting.');
  }
}

/**
 * Returns true IF AND ONLY IF the take has been successfully confirmed in IndexedDB.
 * Memory-only takes return false.
 */
export function isRecordingDurable(key: string): boolean {
  return durableKeys.has(key);
}

/**
 * Returns the exact durability status: "durable", "memory_only", or "unretained".
 */
export function getRecordingDurability(key: string): RecordingDurability {
  if (durableKeys.has(key)) return 'durable';
  if (memoryOnlyKeys.has(key) || retained.has(key)) return 'memory_only';
  return 'unretained';
}

/**
 * Returns true if any pending take for the attempt is only held in volatile RAM
 * without confirmed IndexedDB persistence.
 */
export function hasUnpersistedRecordings(attempt: string): boolean {
  return (
    [...memoryOnlyKeys].some((key) => key.startsWith(`${attempt}:`)) ||
    [...retained.keys()].some((key) => key.startsWith(`${attempt}:`) && !durableKeys.has(key))
  );
}

/**
 * Retries persisting an in-memory take to IndexedDB (e.g. after storage clears).
 * Returns true if durable persistence succeeded.
 */
export async function retryPersistRecording(key: string): Promise<boolean> {
  const blob = retained.get(key);
  if (!blob || !blob.size) return false;
  try {
    await operation('readwrite', (store) => store.put(blob, key));
    durableKeys.add(key);
    memoryOnlyKeys.delete(key);
    return true;
  } catch {
    memoryOnlyKeys.add(key);
    durableKeys.delete(key);
    return false;
  }
}
