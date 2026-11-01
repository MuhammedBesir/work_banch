import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OcrPage, OcrWord } from "./ocr";

// Hangi sayfalar OCR'a muhtaç? PDF'in kendi metni bazen sayfadaki yazının hepsini taşımaz:
//  - taranmış sayfa: hiç metin yok;
//  - bozuk yazı tipi (ToUnicode eksik): metin var ama anlamsız karakterler;
//  - resim içindeki yazı (ekran görüntüsü, tablo, formül resmi) ya da eğriye çevrilmiş yazı:
//    sayfada mürekkep var ama üstünde metin yok.
// Sayfa küçük boyutta çizilir; metin kutularının dışında kalan mürekkep oranı ölçülür.

export type OcrNeed = "none" | "full" | "garbled" | "extra";

export interface PageAnalysis {
  need: OcrNeed;
  /** PDF metninin kutuları (0–1); OCR sonucundan bunlarla çakışan kelimeler atılır. */
  boxes: OcrWord["b"][];
}

/** Anlamsız karakter oranı: özel kullanım alanı, U+FFFD, kontrol karakterleri, harf/rakam olmayanların fazlası. */
export function garbledRatio(text: string): number {
  const chars = [...text.replace(/\s+/g, "")];
  if (!chars.length) return 0;
  let bad = 0;
  let alnum = 0;
  for (const c of chars) {
    const cp = c.codePointAt(0)!;
    if ((cp >= 0xe000 && cp <= 0xf8ff) || cp === 0xfffd || cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) bad++;
    else if (/[\p{L}\p{N}]/u.test(c)) alnum++;
  }
  // Normal metinde harf/rakam oranı yüksektir; çoğu sembolse yazı tipi eşlemesi bozuktur.
  const symbolHeavy = alnum / chars.length < 0.45 ? 1 - alnum / chars.length : 0;
  return Math.max(bad / chars.length, symbolHeavy);
}

/** Metin kutuları dışındaki mürekkep: 0–1 maske üzerinde sayılır (saf fonksiyon, test edilebilir). */
export function uncoveredInk(ink: Uint8Array, w: number, h: number, boxes: OcrWord["b"][], pad = 0.006): { ratio: number; area: number } {
  const covered = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of boxes) {
    const ax = Math.max(0, Math.floor((x0 - pad) * w));
    const bx = Math.min(w, Math.ceil((x1 + pad) * w));
    const ay = Math.max(0, Math.floor((y0 - pad) * h));
    const by = Math.min(h, Math.ceil((y1 + pad) * h));
    for (let y = ay; y < by; y++) covered.fill(1, y * w + ax, y * w + bx);
  }
  let total = 0;
  let out = 0;
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    total++;
    if (!covered[i]) out++;
  }
  return { ratio: total ? out / total : 0, area: out / (w * h) };
}

/** Ham pdf.js metin öğelerinden sayfaya göre 0–1 kutular. */
function textBoxes(items: { str?: string; transform?: number[]; width?: number; height?: number }[], vw: number, vh: number, vt: number[]): OcrWord["b"][] {
  const boxes: OcrWord["b"][] = [];
  for (const it of items) {
    if (!it.str?.trim() || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    const fh = Math.hypot(c, d) || it.height || 0;
    const w = it.width ?? 0;
    // Metin uzayından görünüm uzayına: köşeler.
    const pts = [[e, f], [e + (a / (Math.hypot(a, b) || 1)) * w, f + (b / (Math.hypot(a, b) || 1)) * w], [e - (b / (Math.hypot(a, b) || 1)) * fh, f + (a / (Math.hypot(a, b) || 1)) * fh]];
    pts.push([pts[1][0] + pts[2][0] - e, pts[1][1] + pts[2][1] - f]);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of pts) {
      xs.push(vt[0] * x + vt[2] * y + vt[4]);
      ys.push(vt[1] * x + vt[3] * y + vt[5]);
    }
    // Alt çizgi payı: harf kuyrukları (g, y, ş) kutunun biraz altına iner.
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const desc = (y1 - y0) * 0.25;
    boxes.push([Math.min(...xs) / vw, y0 / vh, Math.max(...xs) / vw, (y1 + desc) / vh]);
  }
  return boxes;
}

const SAMPLE_W = 240;

export async function analyzePage(doc: PDFDocumentProxy, index: number): Promise<PageAnalysis> {
  const page = await doc.getPage(index + 1);
  const tc = await page.getTextContent();
  const items = tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[];
  const text = items.map((it) => it.str ?? "").join("");
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: SAMPLE_W / vp1.width });
  const boxes = textBoxes(items, vp.width, vp.height, vp.transform);
  if (!text.trim()) return { need: "full", boxes };
  if (text.replace(/\s/g, "").length >= 20 && garbledRatio(text) > 0.3) return { need: "garbled", boxes };

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const ink = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // Koyu piksel ya da belirgin renk: yazı, çizim, resim.
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 170) ink[j] = 1;
  }
  const { ratio, area } = uncoveredInk(ink, canvas.width, canvas.height, boxes);
  // Metinsiz mürekkebin hem payı hem miktarı anlamlıysa (küçük logo, çizgi, sayfa numarası değil) tanı.
  return { need: ratio > 0.2 && area > 0.004 ? "extra" : "none", boxes };
}

/** Ek OCR: PDF metniyle çakışan kelimeleri at, kalanlar sayfaya eklenir. */
export function subtractBoxes(ocr: OcrPage, boxes: OcrWord["b"][]): OcrPage {
  const overlaps = (b: OcrWord["b"]) => {
    const area = Math.max(1e-9, (b[2] - b[0]) * (b[3] - b[1]));
    return boxes.some(([x0, y0, x1, y1]) => {
      const w = Math.min(b[2], x1) - Math.max(b[0], x0);
      const h = Math.min(b[3], y1) - Math.max(b[1], y0);
      return w > 0 && h > 0 && (w * h) / area > 0.3;
    });
  };
  const lines = ocr.lines.map((l) => l.filter((wd) => !overlaps(wd.b))).filter((l) => l.length);
  return { ...ocr, lines, text: lines.map((l) => l.map((x) => x.t).join(" ")).join("\n") };
}
