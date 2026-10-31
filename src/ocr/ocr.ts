import type { PDFDocumentProxy } from "pdfjs-dist";

// Tarayıcıda OCR (tesseract.js): taranmış sayfanın metni bu cihazda tanınır, hiçbir yere gönderilmez.
// İşçi, çekirdek ve dil verisi kendi sunucumuzdan (public/ocr) yüklenir; ilk kullanımda ~4–5 MB iner.

export interface OcrWord {
  t: string;
  /** Sayfaya göre 0–1: [x0, y0, x1, y1]. */
  b: [number, number, number, number];
}

export interface OcrPage {
  lines: OcrWord[][];
  text: string;
  confidence: number;
}

type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

let worker: TWorker | null = null;
let starting: Promise<TWorker> | null = null;

const abs = (p: string) => new URL(p, document.baseURI).href;

async function getWorker(onProgress?: (status: string, ratio: number) => void): Promise<TWorker> {
  if (worker) return worker;
  starting ??= (async () => {
    const T = await import("tesseract.js");
    const w = await T.createWorker(["tur", "eng"], 1, {
      workerPath: abs("ocr/worker.min.js"),
      corePath: abs("ocr/core/"),
      langPath: abs("ocr/lang"),
      gzip: true,
      logger: (m) => onProgress?.(m.status, m.progress),
    });
    worker = w;
    return w;
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/** Sayfayı ~2000 px genişlikte çizip tanır. Satır ve kelime kutuları sayfaya göre 0–1. */
export async function recognizePage(doc: PDFDocumentProxy, index: number, onProgress?: (status: string, ratio: number) => void): Promise<OcrPage> {
  const w = await getWorker(onProgress);
  const page = await doc.getPage(index + 1);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, 2000 / vp1.width);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  await page.render({ canvasContext: canvas.getContext("2d", { willReadFrequently: true })!, viewport: vp }).promise;
  return recognizeWith(w, canvas);
}

/** Herhangi bir tuvali tanı (el yazısı): kelime kutuları tuvale göre 0–1. */
export async function recognizeCanvas(canvas: HTMLCanvasElement, onProgress?: (status: string, ratio: number) => void): Promise<OcrPage> {
  return recognizeWith(await getWorker(onProgress), canvas, 10);
}

async function recognizeWith(w: TWorker, canvas: HTMLCanvasElement, minConfidence = 20): Promise<OcrPage> {
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
  const W = canvas.width;
  const H = canvas.height;
  const lines: OcrWord[][] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const words = line.words
          .filter((wd) => wd.text.trim() && wd.confidence > minConfidence)
          .map((wd) => ({ t: wd.text.trim(), b: [wd.bbox.x0 / W, wd.bbox.y0 / H, wd.bbox.x1 / W, wd.bbox.y1 / H] as OcrWord["b"] }));
        if (words.length) lines.push(words);
      }
    }
  }
  return { lines, text: lines.map((l) => l.map((x) => x.t).join(" ")).join("\n"), confidence: data.confidence };
}

export async function stopOcr(): Promise<void> {
  const w = worker;
  worker = null;
  await w?.terminate();
}

/**
 * OCR metin katmanı: pdf.js metin katmanıyla aynı yapı (saydam yazı, mutlak konum, satır sonunda <br>),
 * böylece seçim, vurgu, arama ve AI kapsamı taranmış sayfada da çalışır.
 */
export function buildOcrLayer(container: HTMLElement, ocr: OcrPage, width: number, height: number, append = false): void {
  const ctx = document.createElement("canvas").getContext("2d")!;
  const frag = document.createDocumentFragment();
  for (const line of ocr.lines) {
    line.forEach((wd, i) => {
      const [x0, y0, x1, y1] = wd.b;
      const next = line[i + 1];
      // Kelimeden sonraki boşluk da seçilebilsin: kutu bir sonraki kelimeye kadar uzar.
      const text = next ? `${wd.t} ` : wd.t;
      const right = next ? next.b[0] : x1;
      const fs = Math.max(4, (y1 - y0) * height * 0.92);
      ctx.font = `${fs}px sans-serif`;
      const measured = ctx.measureText(text).width || 1;
      const span = document.createElement("span");
      span.textContent = text;
      if (append) span.className = "is-hw";
      span.style.cssText = `left:${x0 * width}px;top:${y0 * height}px;font-size:${fs}px;font-family:sans-serif;transform:scaleX(${((right - x0) * width) / measured})`;
      frag.append(span);
    });
    frag.append(document.createElement("br"));
  }
  if (append) {
    // El yazısı: PDF'in kendi metin katmanına eklenir (arama ve seçim ikisini birden görür).
    const end = container.querySelector(":scope > .endOfContent");
    if (end) end.before(frag);
    else container.append(frag);
    return;
  }
  // pdf.js'in seçim düzeltmesi bu öğeyi kullanır: boşluğa sürüklenince seçim belgenin sonuna atlamaz.
  frag.append(Object.assign(document.createElement("div"), { className: "endOfContent" }));
  container.replaceChildren(frag);
  container.classList.add("is-ocr");
}
