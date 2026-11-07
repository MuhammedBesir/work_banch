import * as db from "../db";

// Firefox ve Safari'de dosya tutamacı saklanamaz; "Son açılanlar"dan yeniden açabilmek için
// PDF'in bir kopyası tarayıcıda tutulur: OPFS'te, OPFS'e yazılamıyorsa (Safari'de createWritable yok)
// IndexedDB'de (meta "copy:<hash>", Blob olarak). Kota sınırlıdır: büyük dosyalar ve kota dolmak
// üzereyken kopya alınmaz, "Dosyayı yeniden seç" kalır.

const DIR = "pdf";
const MAX_FILE = 200 * 1024 * 1024;
const IDB = "copy:";

type Dir = FileSystemDirectoryHandle;

async function dir(): Promise<Dir | null> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    return root ? await root.getDirectoryHandle(DIR, { create: true }) : null;
  } catch {
    return null;
  }
}

/** Kopya bir yerde saklanabiliyor mu (OPFS ya da IndexedDB). */
export const opfsSupported = (): boolean => typeof indexedDB !== "undefined" || typeof navigator.storage?.getDirectory === "function";

/** Kopyayı sakla; kota yetmezse ya da dosya büyükse sessizce vazgeç. */
export async function saveCopy(hash: string, bytes: Uint8Array): Promise<boolean> {
  if (bytes.byteLength > MAX_FILE || !bytes.byteLength) return false;
  // Bayt dizisi pdf.js'e aktarılınca boşalabilir: ilk await'ten önce kendi kopyamızı al.
  const blob = new Blob([bytes.slice() as unknown as BlobPart], { type: "application/pdf" });
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota && (est.usage ?? 0) + blob.size > est.quota * 0.6) return false;
  } catch {
    /* tahmin yoksa devam */
  }
  if (await saveOpfs(hash, blob)) return true;
  try {
    await db.putMeta(IDB + hash, blob);
    return true;
  } catch {
    return false;
  }
}

async function saveOpfs(hash: string, blob: Blob): Promise<boolean> {
  const d = await dir();
  if (!d) return false;
  const name = `${hash}.pdf`;
  try {
    const fh = await d.getFileHandle(name, { create: true });
    const w = await (fh as FileSystemFileHandle & { createWritable?(): Promise<FileSystemWritableFileStream> }).createWritable?.();
    if (!w) throw new Error("createWritable yok");
    await w.write(blob);
    await w.close();
    if ((await fh.getFile()).size !== blob.size) throw new Error("eksik yazıldı");
    return true;
  } catch {
    // getFileHandle(create) boş dosyayı çoktan oluşturmuş olabilir: "kopya var" sanılmasın.
    await d.removeEntry(name).catch(() => {});
    return false;
  }
}

async function opfsFile(hash: string): Promise<File | null> {
  try {
    const f = await (await (await dir())?.getFileHandle(`${hash}.pdf`))?.getFile();
    return f && f.size > 0 ? f : null;
  } catch {
    return null;
  }
}

export async function readCopy(hash: string, name: string): Promise<File | null> {
  const f = (await opfsFile(hash)) ?? (await db.getMeta<Blob>(IDB + hash).catch(() => undefined));
  return f && f.size > 0 ? new File([f], name, { type: "application/pdf" }) : null;
}

export async function hasCopy(hash: string): Promise<boolean> {
  if (await opfsFile(hash)) return true;
  return (await db.metaKeys(IDB + hash).catch(() => [])).length > 0;
}

export async function deleteCopy(hash: string): Promise<void> {
  try {
    await (await dir())?.removeEntry(`${hash}.pdf`);
  } catch {
    /* yoksa sorun değil */
  }
  await db.deleteMeta(IDB + hash).catch(() => {});
}

export async function copiesUsage(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  try {
    const d = await dir();
    if (d) {
      for await (const h of (d as Dir & { values(): AsyncIterable<FileSystemHandle> }).values()) {
        if (h.kind !== "file") continue;
        const size = (await (h as FileSystemFileHandle).getFile()).size;
        if (!size) continue;
        count++;
        bytes += size;
      }
    }
  } catch {
    /* sayılamadı */
  }
  try {
    for (const k of await db.metaKeys(IDB)) {
      const b = await db.getMeta<Blob>(k);
      if (!b?.size) continue;
      count++;
      bytes += b.size;
    }
  } catch {
    /* sayılamadı */
  }
  return { count, bytes };
}

export async function deleteAllCopies(): Promise<void> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    await root?.removeEntry(DIR, { recursive: true });
  } catch {
    /* yoksa sorun değil */
  }
  try {
    for (const k of await db.metaKeys(IDB)) await db.deleteMeta(k);
  } catch {
    /* yoksa sorun değil */
  }
}
