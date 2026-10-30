import type { FileRecord, Highlight, Mark, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

// Tüm veri bu tarayıcıda, IndexedDB'de yaşar. Hiçbir şey ağa gitmez.

const DB_NAME = "calisma-masasi";
const VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore("files", { keyPath: "hash" });
        const hl = db.createObjectStore("highlights", { keyPath: "id" });
        hl.createIndex("fileHash", "fileHash");
        db.createObjectStore("meta");
      }
      if (e.oldVersion < 2) {
        // Yaz modu işaretleri (v1.1)
        db.createObjectStore("marks", { keyPath: "id" }).createIndex("fileHash", "fileHash");
      }
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

export async function marksFor(fileHash: string): Promise<Mark[]> {
  return wrap((await store("marks")).index("fileHash").getAll(fileHash));
}

export async function allMarks(): Promise<Mark[]> {
  return wrap((await store("marks")).getAll());
}

export async function putMark(m: Mark): Promise<void> {
  await wrap((await store("marks", "readwrite")).put(m));
}

export async function putMarks(list: Mark[]): Promise<void> {
  const tx = (await open()).transaction("marks", "readwrite");
  const s = tx.objectStore("marks");
  for (const m of list) s.put(m);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteMark(id: string): Promise<void> {
  await wrap((await store("marks", "readwrite")).delete(id));
}

/** Küçük yardımcı kayıtlar (AI sohbet geçmişi, hatırlatma zamanları…). */
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return wrap((await store("meta")).get(key));
}

export async function putMeta(key: string, value: unknown): Promise<void> {
  await wrap((await store("meta", "readwrite")).put(value, key));
}

export async function loadSettings(): Promise<Settings> {
  const saved: Partial<Settings> | undefined = await wrap((await store("meta")).get("settings"));
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    names: { ...DEFAULT_SETTINGS.names, ...saved?.names },
    ai: migrateAi(saved?.ai),
    pen: { ...DEFAULT_SETTINGS.pen, ...saved?.pen },
  };
}

/** v2 öncesi AI ayarı ({ mode: "cloud", apiKey, model }) yeni biçime çevrilir. */
function migrateAi(saved: unknown): Settings["ai"] {
  const d = DEFAULT_SETTINGS.ai;
  if (!saved || typeof saved !== "object") return structuredClone(d);
  const old = saved as { mode?: string; apiKey?: string; model?: string } & Partial<Omit<Settings["ai"], "mode">>;
  if (old.apiKey !== undefined || old.mode === "cloud") {
    return {
      ...structuredClone(d),
      mode: old.mode === "cloud" ? "anthropic" : "off",
      keys: { ...d.keys, anthropic: old.apiKey ?? "" },
      models: { ...d.models, ...(old.model ? { anthropic: old.model } : {}) },
    };
  }
  const { apiKey: _k, model: _m, ...rest } = old;
  return { ...d, ...rest, keys: { ...d.keys, ...old.keys }, models: { ...d.models, ...old.models } } as Settings["ai"];
}

export async function saveSettings(s: Settings): Promise<void> {
  await wrap((await store("meta", "readwrite")).put(s, "settings"));
}

export async function clearAll(): Promise<void> {
  const stores = ["files", "highlights", "marks", "meta"];
  const tx = (await open()).transaction(stores, "readwrite");
  for (const name of stores) tx.objectStore(name).clear();
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
