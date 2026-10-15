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

function memoryList(namespace: string): OfflineRecord[] {
  const prefix = `${PREFIX}${namespace}.`;
  return [...memory.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => ({ key, value, updatedAt: 0 }));
}

/** Write one value. Returns false when storage is unavailable or full. */
export async function offlinePut(namespace: string, key: string, value: string): Promise<boolean> {
  const storageKey = storeKey(namespace, key);
  try {
    if (offlineStoreBackend() === 'indexeddb') {
      const record: OfflineRecord = { key: storageKey, value, updatedAt: Date.now() };
      await idbRun('readwrite', (store) => store.put(record, storageKey));
      return true;
    }
    const store = localStore();
    if (store) {
      store.setItem(storageKey, value);
      return true;
    }
    memory.set(storageKey, value);
    return true;
  } catch {
    return false;
  }
}

/** Read one value, or null when missing/unreadable. */
export async function offlineGet(namespace: string, key: string): Promise<string | null> {
  const storageKey = storeKey(namespace, key);
  try {
    if (offlineStoreBackend() === 'indexeddb') {
      const record = await idbRun<OfflineRecord | undefined>('readonly', (store) => store.get(storageKey));
      return record && typeof record.value === 'string' ? record.value : null;
    }
    const store = localStore();
    if (store) return store.getItem(storageKey);
    return memory.get(storageKey) ?? null;
  } catch {
    return null;
  }
}

/** Every entry of one namespace, with the namespace prefix stripped from `key`. */
export async function offlineList(namespace: string): Promise<Array<{ key: string; value: string }>> {
  const prefix = `${PREFIX}${namespace}.`;
  try {
    let records: OfflineRecord[];
    if (offlineStoreBackend() === 'indexeddb') {
      records = await idbList();
    } else {
      const store = localStore();
      if (store) {
        records = [];
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (key && key.startsWith(prefix)) records.push({ key, value: store.getItem(key) ?? '', updatedAt: 0 });
        }
      } else {
        records = memoryList(namespace);
      }
    }
    return records
      .filter((record) => record.key.startsWith(prefix))
      .map((record) => ({ key: record.key.slice(prefix.length), value: record.value }));
  } catch {
    return [];
  }
}

/** Remove one value. True when the delete was performed. */
export async function offlineDelete(namespace: string, key: string): Promise<boolean> {
  const storageKey = storeKey(namespace, key);
  try {
    if (offlineStoreBackend() === 'indexeddb') {
      await idbRun('readwrite', (store) => store.delete(storageKey));
      return true;
    }
    const store = localStore();
    if (store) {
      store.removeItem(storageKey);
      return true;
    }
    memory.delete(storageKey);
    return true;
  } catch {
    return false;
  }
}

/** Drop a whole namespace (e.g. when an attempt is finished). */
export async function offlinePurge(namespace: string): Promise<void> {
  const entries = await offlineList(namespace).catch(() => []);
  for (const entry of entries) {
    await offlineDelete(namespace, entry.key).catch(() => false);
  }
}
