import * as db from "./db";
import type { Card, FileRecord, Highlight, Mark, Settings } from "./types";

// JSON yedek: vurgular, notlar, Yaz modu işaretleri, yer imleri, kaldığın yer ve ayarlar.
// Quizler, tanınmış el yazısı ve OCR metni de girer (yeniden üretmesi pahalı). Dosyaların kendisi,
// ses kayıtları ve AI API anahtarı yedeğe girmez.

/** Yedeğe giren dosya başına meta kayıtları. */
const META_PREFIXES = ["quiz:", "hw:", "ocr:", "ai:", "folders"];

export interface Backup {
  app: "calisma-masasi";
  version: 1;
  createdAt: string;
  settings: Settings;
  files: Omit<FileRecord, "handle">[];
  highlights: Highlight[];
  marks?: Mark[];
  cards?: Card[];
  /** Dosya başına meta: quizler, el yazısı, OCR metni, AI sohbet geçmişi. */
  meta?: Record<string, unknown>;
}

export async function createBackup(): Promise<Backup> {
  const [settings, files, highlights, marks, cards, meta] = await Promise.all([db.loadSettings(), db.allFiles(), db.allHighlights(), db.allMarks(), db.allCards(), db.metaWithPrefix(META_PREFIXES)]);
  return {
    app: "calisma-masasi",
    version: 1,
    createdAt: new Date().toISOString(),
    settings: { ...settings, ai: { ...settings.ai, keys: Object.fromEntries(Object.keys(settings.ai.keys).map((k) => [k, ""])) as typeof settings.ai.keys } },
    files: files.map(({ handle: _h, ...rest }) => rest),
    highlights,
    marks,
    cards,
    meta,
  };
}

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Bu dosya okunamadı. Çalışma Masası'ndan alınmış bir .json yedeği seç.");
  }
  const b = data as Partial<Backup>;
  if (b?.app !== "calisma-masasi" || !Array.isArray(b.highlights) || !Array.isArray(b.files)) {
    throw new Error("Bu bir Çalışma Masası yedeği değil. Ayarlar'dan alınmış bir .json yedeği seç.");
  }
  return b as Backup;
}

/** Yedekteki kayıtları ekler; aynı kimlikli vurgular yedektekiyle değişir, diğerleri kalır. */
export async function restoreBackup(b: Backup): Promise<{ highlights: number; files: number; marks: number }> {
  for (const f of b.files) {
    const existing = await db.getFile(f.hash);
    await db.putFile({ ...f, handle: existing?.handle, lastOpened: Math.max(f.lastOpened, existing?.lastOpened ?? 0) });
  }
  await db.putHighlights(b.highlights);
  await db.putMarks(b.marks ?? []);
  await db.putCards(b.cards ?? []);
  // Yalnızca bilinen dosya meta kayıtları geri yazılır (ayarlar ve anahtarlar değil).
  for (const [k, v] of Object.entries(b.meta ?? {})) {
    if (META_PREFIXES.some((p) => k.startsWith(p))) await db.putMeta(k, v);
  }
  if (b.settings) {
    // Yedekte anahtar yok: bu tarayıcıdaki anahtar korunur.
    const current = await db.loadSettings();
    await db.saveSettings({ ...b.settings, ai: { ...current.ai, ...b.settings.ai, keys: current.ai.keys } });
  }
  return { highlights: b.highlights.length, files: b.files.length, marks: b.marks?.length ?? 0 };
}
