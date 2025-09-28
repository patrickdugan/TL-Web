import type { AlgoIndexItem } from './algo-meta';

const DB_NAME = 'tl-algos';
const DB_VERSION = 1;
const STORE_INDEX = 'index';
const STORE_FILES = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE_INDEX)) db.createObjectStore(STORE_INDEX, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES, { keyPath: 'fileName' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function dbGetIndex(): Promise<AlgoIndexItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_INDEX, 'readonly');
    const store = tx.objectStore(STORE_INDEX);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as AlgoIndexItem[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutIndex(list: AlgoIndexItem[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_INDEX, 'readwrite');
    const store = tx.objectStore(STORE_INDEX);
    const clear = store.clear();
    clear.onsuccess = () => {
      if (list.length === 0) return resolve();
      let left = list.length;
      list.forEach(i => {
        const w = store.put(i);
        w.onsuccess = () => { if (--left === 0) resolve(); };
        w.onerror = () => reject(w.error);
      });
    };
    clear.onerror = () => reject(clear.error);
  });
}

export async function dbPutFile(fileName: string, source: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    const w = store.put({ fileName, source });
    w.onsuccess = () => resolve();
    w.onerror = () => reject(w.error);
  });
}

export async function dbGetFile(fileName: string): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const r = store.get(fileName);
    r.onsuccess = () => resolve(r.result?.source ?? null);
    r.onerror = () => reject(r.error);
  });
}
