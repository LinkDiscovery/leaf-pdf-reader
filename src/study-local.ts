import { validEntry, type StudyEntry } from './study-model';
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('leaf-study', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
}
export async function localEntries(): Promise<StudyEntry[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('entries').objectStore('entries').getAll();
    request.onsuccess = () => resolve(request.result.filter(validEntry));
    request.onerror = () => reject(request.error);
  });
}
export async function writeLocal(entries: StudyEntry[], remove?: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite');
    const store = tx.objectStore('entries');
    entries.forEach(entry => store.put(entry));
    if (remove) store.delete(remove);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('기기 저장이 중단되었어요.'));
  });
}
