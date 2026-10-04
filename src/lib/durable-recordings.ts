/** Completed takes are retained until the backend acknowledges upload. */
const DB = 'bestway-recordings-v1';
const active = new Set<string>();
// A failed IndexedDB write must still prevent final submission while the take
// exists in this page. Durable storage remains necessary for crash recovery.
const retained = new Map<string, Blob>();
export function markActiveRecording(key: string, busy: boolean) { if (busy) active.add(key); else active.delete(key); }
export function hasActiveRecording(attempt: string) { return [...active].some((key) => key.startsWith(`${attempt}:`)); }
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
export function retainRecording(key: string, blob: Blob) {
  if (!blob.size) return Promise.reject(new Error('The microphone produced an empty recording.'));
  retained.set(key, blob);
  return operation('readwrite', (store) => store.put(blob, key));
}
export async function recoverRecording(key: string): Promise<Blob | undefined> {
  return retained.get(key) ?? operation('readonly', (store) => store.get(key));
}
export async function releaseRecording(key: string) {
  await operation('readwrite', (store) => store.delete(key));
  retained.delete(key);
}
export async function hasPendingRecordings(attempt: string) {
  if ([...retained.keys()].some((key) => key.startsWith(`${attempt}:`))) return true;
  return (await operation('readonly', (store) => store.getAllKeys())).some((key) => String(key).startsWith(`${attempt}:`));
}
