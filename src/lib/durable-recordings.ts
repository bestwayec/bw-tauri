/** Completed takes are retained until the backend acknowledges upload. */
const DB = 'bestway-recordings-v1';
const active = new Set<string>();
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
export const retainRecording = (key: string, blob: Blob) => operation('readwrite', (store) => store.put(blob, key));
export const recoverRecording = (key: string): Promise<Blob | undefined> => operation('readonly', (store) => store.get(key));
export const releaseRecording = (key: string) => operation('readwrite', (store) => store.delete(key));
export async function hasPendingRecordings(attempt: string) {
  return (await operation('readonly', (store) => store.getAllKeys())).some((key) => String(key).startsWith(`${attempt}:`));
}
