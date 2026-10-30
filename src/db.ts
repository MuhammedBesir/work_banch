import type { FileRecord, Highlight, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

// Tüm veri bu tarayıcıda, IndexedDB'de yaşar. Hiçbir şey ağa gitmez.

const DB_NAME = "calisma-masasi";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("files", { keyPath: "hash" });
      const hl = db.createObjectStore("highlights", { keyPath: "id" });
      hl.createIndex("fileHash", "fileHash");
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = "readonly") {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function getFile(hash: string): Promise<FileRecord | undefined> {
  return wrap((await store("files")).get(hash));
}

export async function putFile(rec: FileRecord): Promise<void> {
  await wrap((await store("files", "readwrite")).put(rec));
}

export async function allFiles(): Promise<FileRecord[]> {
  const files: FileRecord[] = await wrap((await store("files")).getAll());
  return files.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function deleteFile(hash: string): Promise<void> {
  await wrap((await store("files", "readwrite")).delete(hash));
}

export async function highlightsFor(fileHash: string): Promise<Highlight[]> {
  const s = await store("highlights");
  return wrap(s.index("fileHash").getAll(fileHash));
}

export async function allHighlights(): Promise<Highlight[]> {
  return wrap((await store("highlights")).getAll());
}

export async function putHighlight(h: Highlight): Promise<void> {
  await wrap((await store("highlights", "readwrite")).put(h));
}

export async function putHighlights(list: Highlight[]): Promise<void> {
  const tx = (await open()).transaction("highlights", "readwrite");
  const s = tx.objectStore("highlights");
  for (const h of list) s.put(h);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteHighlight(id: string): Promise<void> {
  await wrap((await store("highlights", "readwrite")).delete(id));
}

export async function countHighlights(fileHash: string): Promise<number> {
  const s = await store("highlights");
  return wrap(s.index("fileHash").count(fileHash));
}

export async function loadSettings(): Promise<Settings> {
  const saved: Partial<Settings> | undefined = await wrap((await store("meta")).get("settings"));
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    names: { ...DEFAULT_SETTINGS.names, ...saved?.names },
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await wrap((await store("meta", "readwrite")).put(s, "settings"));
}

export async function clearAll(): Promise<void> {
  const tx = (await open()).transaction(["files", "highlights", "meta"], "readwrite");
  for (const name of ["files", "highlights", "meta"]) tx.objectStore(name).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Safari 7 gün kullanılmayan sitenin verisini silebilir: kalıcı saklama iste. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
