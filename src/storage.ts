export type Color = 'yellow' | 'green' | 'pink';
export type Region = { pageIndex: number; rect: [number, number, number, number] };
export type Highlight = { id: string; documentId: string; color: Color; regions: Region[]; note?: string; quote?: string };
export const colors: Record<Color, string> = { yellow: '#f5cf4c', green: '#7bcba3', pink: '#ed93b3' };
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  return dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('leaf-reader', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = undefined; reject(request.error); };
  });
}
export async function getHighlights(id: string): Promise<Highlight[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').get(id);
    request.onsuccess = () => resolve(request.result?.highlights ?? []);
    request.onerror = () => reject(request.error);
  });
}
export async function saveHighlights(id: string, highlights: Highlight[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').put({ id, highlights });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('저장이 중단되었습니다.'));
  });
}
export async function documentHash(bytes: Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
