import type * as PdfjsNS from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

// pdf.js ayrı parça: açılış ekranı onsuz hızlı açılır; ilk dosyada (ya da boşta önceden) yüklenir.
let lib: typeof PdfjsNS | null = null;
let loading: Promise<typeof PdfjsNS> | null = null;

export function loadPdfjs(): Promise<typeof PdfjsNS> {
  if (lib) return Promise.resolve(lib);
  loading ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([m, w]) => {
    m.GlobalWorkerOptions.workerSrc = w.default;
    lib = m;
    return m;
  });
  return loading;
}

/** Yüklenmiş pdf.js (bir belge açıldıktan sonra her zaman hazırdır). */
export function pdfjs(): typeof PdfjsNS {
  if (!lib) throw new Error("pdf.js henüz yüklenmedi");
  return lib;
}

export type PasswordPrompt = (wrong: boolean) => Promise<string | null>;

export class OpenError extends Error {
  constructor(
    public kind: "not-pdf" | "corrupt" | "cancelled",
    message: string,
    public detail = "",
  ) {
    super(message);
  }
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-" başlığı ilk 1 KB içinde olmalı.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

/** PDF'i açar; parola gerekiyorsa sorar. Parola yalnızca bellekte, bu açılış için tutulur. */
export async function openPdf(data: Uint8Array, askPassword: PasswordPrompt): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    enableXfa: false,
    disableAutoFetch: false,
  });
  let cancelled = false;
  task.onPassword = async (update: (pw: string) => void, reason: number) => {
    const pw = await askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (pw === null) {
      cancelled = true;
      task.destroy();
    } else update(pw);
  };
  try {
    return await task.promise;
  } catch (err) {
    if (cancelled) throw new OpenError("cancelled", "Vazgeçildi");
    throw new OpenError("corrupt", "Bu dosya açılamadı", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
}

/** İlk 5 sayfada hiç metin yoksa taranmış belge sayılır. */
export async function looksScanned(doc: PDFDocumentProxy): Promise<boolean> {
  const n = Math.min(5, doc.numPages);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    if (tc.items.some((it) => "str" in it && it.str.trim() !== "")) return false;
  }
  return true;
}

/** PDF'in kendi içindekiler ağacı, sayfa numaralarıyla (0 tabanlı). */
export interface OutlineItem {
  title: string;
  page: number | null;
  children: OutlineItem[];
}

export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineItem[]> {
  const raw = await doc.getOutline();
  if (!raw) return [];
  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === "string" ? await doc.getDestination(dest) : (dest as unknown[] | null);
      if (!explicit?.length) return null;
      const ref = explicit[0];
      return typeof ref === "number" ? ref : await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]);
    } catch {
      return null;
    }
  };
  type Raw = { title: string; dest: unknown; items: Raw[] };
  const walk = async (items: Raw[]): Promise<OutlineItem[]> =>
    Promise.all(items.map(async (it) => ({ title: it.title, page: await resolve(it.dest), children: await walk(it.items ?? []) })));
  return walk(raw as Raw[]);
}

/** Dosya başına sayfa metni önbelleği: arama için. */
export async function pageText(doc: PDFDocumentProxy, index: number): Promise<string> {
  const page = await doc.getPage(index + 1);
  const tc = await page.getTextContent();
  return tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
}
