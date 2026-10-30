import * as db from "./db";
import type { FileRecord, Highlight, Settings } from "./types";

// JSON yedek: vurgular, notlar, yer imleri, kaldığın yer ve ayarlar. Dosyaların kendisi yedeğe girmez.

export interface Backup {
  app: "calisma-masasi";
  version: 1;
  createdAt: string;
  settings: Settings;
  files: Omit<FileRecord, "handle">[];
  highlights: Highlight[];
}

export async function createBackup(): Promise<Backup> {
  const [settings, files, highlights] = await Promise.all([db.loadSettings(), db.allFiles(), db.allHighlights()]);
  return {
    app: "calisma-masasi",
    version: 1,
    createdAt: new Date().toISOString(),
    settings,
    files: files.map(({ handle: _h, ...rest }) => rest),
    highlights,
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
export async function restoreBackup(b: Backup): Promise<{ highlights: number; files: number }> {
  for (const f of b.files) {
    const existing = await db.getFile(f.hash);
    await db.putFile({ ...f, handle: existing?.handle, lastOpened: Math.max(f.lastOpened, existing?.lastOpened ?? 0) });
  }
  await db.putHighlights(b.highlights);
  if (b.settings) await db.saveSettings(b.settings);
  return { highlights: b.highlights.length, files: b.files.length };
}
