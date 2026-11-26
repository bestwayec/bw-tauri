/**
 * Offline-first key/value store for exam data (SQLite-equivalent durability for
 * the webview: IndexedDB, with a localStorage fallback and an in-memory floor).
 *
 * Everything here is defensive by design: an exam must never break because
 * storage is unavailable, full or disabled in private mode. Reads return null,
 * writes return false, listings return [] — no call ever throws.
 *
 * Namespaced key format: `offline.<namespace>.<key>`.
 */
export type OfflineBackend = 'indexeddb' | 'localstorage' | 'none';
export type DurabilityTier = 'indexeddb' | 'localstorage' | 'memory' | 'failed';

export interface OfflineWriteResult {
  ok: boolean;
  tier: DurabilityTier;
  error?: string;
}

export interface OfflineListResult {
  ok: boolean;
  entries: Array<{ key: string; value: string }>;
  error?: string;
}

export interface OfflineGetResult {
  ok: boolean;
  value: string | null;
  error?: string;
}

interface OfflineRecord {
  key: string;
  value: string;
  updatedAt: number;
}

const DB_NAME = 'bestway-offline-v1';
const STORE = 'kv';
const PREFIX = 'offline.';

/** Last-resort storage when neither IndexedDB nor localStorage exists. */
const memory = new Map<string, string>();

let backend: OfflineBackend | null = null;

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function localStore(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null ? localStorage : null;
  } catch {
    return null;
  }
}

/** Which backend this page will use (detected once). */
export function offlineStoreBackend(): OfflineBackend {
  if (backend === null) {
    backend = hasIndexedDb() ? 'indexeddb' : localStore() ? 'localstorage' : 'none';
  }
  return backend;
}

function storeKey(namespace: string, key: string): string {
  return `${PREFIX}${namespace}.${key}`;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbRun<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Every record of the object store; the caller filters by namespace prefix. */
async function idbList(): Promise<OfflineRecord[]> {
  const records = await idbRun<OfflineRecord[]>('readonly', (store) => store.getAll() as IDBRequest<OfflineRecord[]>);
  return Array.isArray(records)
    ? records.filter((record) => record && typeof record.key === 'string')
    : [];
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Offline storage operation failed';
}

/**
 * Write one value with explicit durability reporting.
 * Attempts primary backend (IndexedDB), falls back to localStorage on IDB failure,
 * and falls back to volatile RAM if disk storage is unavailable or full.
 */
export async function offlinePutDurable(
  namespace: string,
  key: string,
  value: string,
  allowMemoryFallback = true,
): Promise<OfflineWriteResult> {
  const storageKey = storeKey(namespace, key);
  const currentBackend = offlineStoreBackend();

  if (currentBackend === 'indexeddb') {
    try {
      const record: OfflineRecord = { key: storageKey, value, updatedAt: Date.now() };
      await idbRun('readwrite', (store) => store.put(record, storageKey));
      // Remove any older fallback copies once primary IDB succeeds.
      const store = localStore();
      try { store?.removeItem(storageKey); } catch { /* ignore */ }
      memory.delete(storageKey);
      return { ok: true, tier: 'indexeddb' };
    } catch (idbErr) {
      const msg = errorMessage(idbErr);
      const store = localStore();
      if (store) {
        try {
          store.setItem(storageKey, value);
          memory.delete(storageKey);
          return { ok: true, tier: 'localstorage', error: msg };
        } catch (lsErr) {
          if (allowMemoryFallback) memory.set(storageKey, value);
          return { ok: false, tier: allowMemoryFallback ? 'memory' : 'failed', error: `${msg}; ${errorMessage(lsErr)}` };
        }
      }
      if (allowMemoryFallback) memory.set(storageKey, value);
      return { ok: false, tier: allowMemoryFallback ? 'memory' : 'failed', error: msg };
    }
  }

  if (currentBackend === 'localstorage') {
    const store = localStore();
    if (store) {
      try {
        store.setItem(storageKey, value);
        memory.delete(storageKey);
        return { ok: true, tier: 'localstorage' };
      } catch (lsErr) {
        if (allowMemoryFallback) memory.set(storageKey, value);
        return { ok: false, tier: allowMemoryFallback ? 'memory' : 'failed', error: errorMessage(lsErr) };
      }
    }
  }

  if (allowMemoryFallback) {
    memory.set(storageKey, value);
    return { ok: false, tier: 'memory', error: 'No durable disk storage available (memory only)' };
  }
  return { ok: false, tier: 'failed', error: 'No durable disk storage available' };
}

/** Write one value. Returns false when durable storage is unavailable or full (memory fallback still works when backend is 'none'). */
export async function offlinePut(namespace: string, key: string, value: string): Promise<boolean> {
  const allowMem = offlineStoreBackend() === 'none';
  const result = await offlinePutDurable(namespace, key, value, allowMem);
  if (result.ok) return true;
  // Preserve legacy contract: when neither IndexedDB nor localStorage exists at all, memory fallback returns true.
  return allowMem && result.tier === 'memory';
}

/** Read one value with explicit read-error reporting so failures are distinguishable from missing keys. */
export async function offlineGetStrict(namespace: string, key: string): Promise<OfflineGetResult> {
  const storageKey = storeKey(namespace, key);
  let idbError: string | undefined;
  if (offlineStoreBackend() === 'indexeddb') {
    try {
      const record = await idbRun<OfflineRecord | undefined>('readonly', (store) => store.get(storageKey));
      if (record && typeof record.value === 'string') {
        return { ok: true, value: record.value };
      }
    } catch (err) {
      idbError = errorMessage(err);
    }
  }
  const store = localStore();
  if (store) {
    try {
      const val = store.getItem(storageKey);
      if (val !== null) return { ok: !idbError, value: val, ...(idbError ? { error: idbError } : {}) };
    } catch (err) {
      return { ok: false, value: memory.get(storageKey) ?? null, error: idbError ?? errorMessage(err) };
    }
  }
  const mem = memory.get(storageKey) ?? null;
  if (idbError) return { ok: false, value: mem, error: idbError };
  return { ok: true, value: mem };
}

/** Read one value, or null when missing/unreadable. */
export async function offlineGet(namespace: string, key: string): Promise<string | null> {
  return (await offlineGetStrict(namespace, key)).value;
}

/** List every entry of one namespace with explicit read-error reporting (includes fallback tiers if IDB failed). */
export async function offlineListStrict(namespace: string): Promise<OfflineListResult> {
  const prefix = `${PREFIX}${namespace}.`;
  const merged = new Map<string, string>();
  let readError: string | undefined;

  if (offlineStoreBackend() === 'indexeddb') {
    try {
      const records = await idbList();
      for (const record of records) {
        if (record.key.startsWith(prefix)) {
          merged.set(record.key.slice(prefix.length), record.value);
        }
      }
    } catch (err) {
      readError = errorMessage(err);
    }
  }

  const store = localStore();
  if (store) {
    try {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.startsWith(prefix)) {
          const shortKey = key.slice(prefix.length);
          if (!merged.has(shortKey)) {
            merged.set(shortKey, store.getItem(key) ?? '');
          }
        }
      }
    } catch (err) {
      readError = readError ?? errorMessage(err);
    }
  }

  for (const [key, value] of memory.entries()) {
    if (key.startsWith(prefix)) {
      const shortKey = key.slice(prefix.length);
      if (!merged.has(shortKey)) {
        merged.set(shortKey, value);
      }
    }
  }

  const entries = [...merged.entries()].map(([key, value]) => ({ key, value }));
  return { ok: !readError, entries, ...(readError ? { error: readError } : {}) };
}

/** Every entry of one namespace, with the namespace prefix stripped from `key`. */
export async function offlineList(namespace: string): Promise<Array<{ key: string; value: string }>> {
  return (await offlineListStrict(namespace)).entries;
}

/** Remove one value. True when the delete was performed. */
export async function offlineDelete(namespace: string, key: string): Promise<boolean> {
  const storageKey = storeKey(namespace, key);
  let ok = true;
  if (offlineStoreBackend() === 'indexeddb') {
    try {
      await idbRun('readwrite', (store) => store.delete(storageKey));
    } catch {
      ok = false;
    }
  }
  const store = localStore();
  if (store) {
    try { store.removeItem(storageKey); } catch { ok = false; }
  }
  memory.delete(storageKey);
  return ok;
}

/** Delete an acknowledged snapshot only if no newer write replaced it. */
export async function offlineDeleteIfValue(namespace: string, key: string, expected: string): Promise<boolean> {
  const storageKey = storeKey(namespace, key);
  let removedAny = false;
  try {
    if (offlineStoreBackend() === 'indexeddb') {
      const db = await database();
      removedAny = await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        let removed = false;
        const store = tx.objectStore(STORE);
        const read = store.get(storageKey);
        read.onsuccess = () => {
          if ((read.result as OfflineRecord | undefined)?.value === expected) {
            store.delete(storageKey);
            removed = true;
          }
        };
        tx.oncomplete = () => { db.close(); resolve(removed); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      });
    }
  } catch {
    /* still check fallback tiers */
  }
  const store = localStore();
  if (store) {
    try {
      if (store.getItem(storageKey) === expected) {
        store.removeItem(storageKey);
        removedAny = true;
      }
    } catch { /* ignore */ }
  }
  if (memory.get(storageKey) === expected) {
    memory.delete(storageKey);
    removedAny = true;
  }
  return removedAny;
}

/** Drop a whole namespace (e.g. when an attempt is finished). */
export async function offlinePurge(namespace: string): Promise<void> {
  const entries = await offlineList(namespace).catch(() => []);
  for (const entry of entries) {
    await offlineDelete(namespace, entry.key).catch(() => false);
  }
}

/** Vocabulary writes require a committed IndexedDB transaction or localStorage write. */
export async function updateDurableOfflineValue<T>(
  namespace: string,
  key: string,
  update: (current: string | null) => { value: string; result: T },
): Promise<T> {
  const storageKey = storeKey(namespace, key);
  if (offlineStoreBackend() !== 'indexeddb') {
    const store = localStore();
    if (!store) throw new Error('Durable offline storage is unavailable');
    const write = () => {
      const next = update(store.getItem(storageKey));
      store.setItem(storageKey, next.value);
      return next.result;
    };
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(storageKey, write);
    }
    return write();
  }
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(storageKey);
      let next: { value: string; result: T };
      let failure: unknown;
      request.onsuccess = () => {
        try {
          next = update((request.result as OfflineRecord | undefined)?.value ?? null);
          store.put({ key: storageKey, value: next.value, updatedAt: Date.now() }, storageKey);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(next.result);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Offline write was interrupted'));
    });
  } finally {
    db.close();
  }
}

/** Account removal must report storage errors to the caller. */
export async function purgeDurableOfflinePrefix(namespace: string): Promise<void> {
  const prefix = storeKey(namespace, "");
  if (offlineStoreBackend() === 'indexeddb') {
    await idbRun('readwrite', (store) => store.delete(IDBKeyRange.bound(prefix, prefix + '\uffff')));
  }
  const local = localStore();
  if (local) {
    const keys = Array.from({ length: local.length }, (_, index) => local.key(index));
    for (const key of keys) {
      if (key?.startsWith(prefix)) local.removeItem(key);
    }
  }
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
}
