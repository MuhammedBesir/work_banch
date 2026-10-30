import * as db from "../db";

// Hata günlüğü: yalnızca kullanıcı açarsa, yalnızca bu tarayıcıda tutulur; hiçbir yere gönderilmez.
// Ayarlar'dan görüntülenir, .json olarak indirilir (destek isterken paylaşmak için) ya da silinir.

export interface ErrorEntry {
  at: number;
  message: string;
  stack?: string;
  kind: "hata" | "söz" | "konsol";
  version: string;
}

const KEY = "errors";
const MAX = 100;
let enabled = false;
let queue: Promise<void> = Promise.resolve();

export function setErrorLog(on: boolean): void {
  enabled = on;
}

/** Yığın izinde dosya yolları sadeleşir: kullanıcının bilgisayarına dair bir şey kalmasın. */
const clean = (s?: string) => s?.replace(/(blob:)?https?:\/\/[^\s)]+\/(assets\/)?/g, "").slice(0, 2000);

export function logError(kind: ErrorEntry["kind"], err: unknown): void {
  if (!enabled) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const entry: ErrorEntry = { at: Date.now(), message: clean(e.message)!.slice(0, 500), stack: clean(e.stack), kind, version: __APP_VERSION__ };
  queue = queue.then(async () => {
    const list = (await db.getMeta<ErrorEntry[]>(KEY)) ?? [];
    list.push(entry);
    await db.putMeta(KEY, list.slice(-MAX));
  }).catch(() => {});
}

export const readErrors = async (): Promise<ErrorEntry[]> => (await db.getMeta<ErrorEntry[]>(KEY)) ?? [];
export const clearErrors = () => db.putMeta(KEY, []);

export function installErrorLog(): void {
  window.addEventListener("error", (e) => logError("hata", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logError("söz", e.reason));
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    orig(...args);
    logError("konsol", args.find((a) => a instanceof Error) ?? args.map(String).join(" "));
  };
}
