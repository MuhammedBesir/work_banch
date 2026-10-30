// Firefox ve Safari'de dosya tutamacı saklanamaz; "Son açılanlar"dan yeniden açabilmek için
// PDF'in bir kopyası tarayıcının kendi depolama alanında (OPFS) tutulur. Kota sınırlıdır:
// büyük dosyalar ve kota dolmak üzereyken kopya alınmaz, "Dosyayı yeniden seç" kalır.

const DIR = "pdf";
const MAX_FILE = 200 * 1024 * 1024;

type Dir = FileSystemDirectoryHandle;

async function dir(): Promise<Dir | null> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    return root ? await root.getDirectoryHandle(DIR, { create: true }) : null;
  } catch {
    return null;
  }
}

export const opfsSupported = (): boolean => typeof navigator.storage?.getDirectory === "function";

/** Kopyayı sakla; kota yetmezse ya da dosya büyükse sessizce vazgeç. */
export async function saveCopy(hash: string, bytes: Uint8Array): Promise<boolean> {
  if (bytes.byteLength > MAX_FILE) return false;
  try {
    const est = await navigator.storage.estimate();
    if (est.quota && (est.usage ?? 0) + bytes.byteLength > est.quota * 0.6) return false;
    const d = await dir();
    if (!d) return false;
    const fh = await d.getFileHandle(`${hash}.pdf`, { create: true });
    // Safari'de createWritable olmayabilir: o zaman kopya alınmaz.
    const w = await (fh as FileSystemFileHandle & { createWritable?(): Promise<FileSystemWritableFileStream> }).createWritable?.();
    if (!w) return false;
    await w.write(bytes as unknown as BufferSource);
    await w.close();
    return true;
  } catch {
    return false;
  }
}

export async function readCopy(hash: string, name: string): Promise<File | null> {
  try {
    const d = await dir();
    const f = await (await d?.getFileHandle(`${hash}.pdf`))?.getFile();
    return f ? new File([f], name, { type: "application/pdf" }) : null;
  } catch {
    return null;
  }
}

export async function hasCopy(hash: string): Promise<boolean> {
  try {
    await (await dir())?.getFileHandle(`${hash}.pdf`);
    return true;
  } catch {
    return false;
  }
}

export async function deleteCopy(hash: string): Promise<void> {
  try {
    await (await dir())?.removeEntry(`${hash}.pdf`);
  } catch {
    /* yoksa sorun değil */
  }
}

export async function copiesUsage(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  try {
    const d = await dir();
    if (!d) return { count, bytes };
    for await (const h of (d as Dir & { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (h.kind !== "file") continue;
      count++;
      bytes += (await (h as FileSystemFileHandle).getFile()).size;
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
}
