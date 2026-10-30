import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, degrees, rgb, type PDFPage } from "pdf-lib";
import { viewToPdf } from "../export/pdf";
import type { Rect } from "../types";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface Source {
  id: string;
  name: string;
  /** İçerik özeti: birleştirilen PDF'in vurguları yeni kopyaya taşınabilsin diye. */
  hash?: string;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
}

export interface EditPage {
  key: string;
  /** Kaynak PDF; boş not sayfası için null. */
  src: string | null;
  /** Kaynaktaki 0 tabanlı sayfa sırası. */
  index: number;
  /** Kullanıcının eklediği saat yönü dönüş: 0, 90, 180, 270. */
  rotation: number;
  blank?: "blank" | "lined" | "grid";
  /** Kırpma: döndürülmüş (görünen) sayfaya göre 0–1 kutu. */
  crop?: Rect;
  /** Not alanı: sayfanın sağına, görünen genişliğin bu oranında boş alan eklenir. */
  margin?: number;
}

/** İçindekiler: başlık ve asıl dosyadaki 0 tabanlı sayfa. */
export interface OutlineNode {
  title: string;
  page: number | null;
  children: OutlineNode[];
}

const A4: [number, number] = [595.28, 841.89];
const LINE = rgb(0.81, 0.85, 0.89);

/** Sayfa listesinden yeni bir PDF üretir (pdf-lib, tamamen tarayıcıda). */
export async function buildPdf(pages: EditPage[], sources: Map<string, Pick<Source, "id" | "bytes">>, outline: OutlineNode[] = []): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const loaded = new Map<string, PDFDocument>();
  let lastSize: [number, number] = A4;

  for (const p of pages) {
    if (p.blank || !p.src) {
      const page = out.addPage(lastSize);
      if (p.blank === "lined") drawLined(page);
      if (p.blank === "grid") drawGrid(page);
      continue;
    }
    let src = loaded.get(p.src);
    if (!src) {
      src = await PDFDocument.load(sources.get(p.src)!.bytes, { updateMetadata: false });
      loaded.set(p.src, src);
    }
    const [copy] = await out.copyPages(src, [p.index]);
    const base = copy.getRotation().angle;
    const rotation = (((base + p.rotation) % 360) + 360) % 360;
    copy.setRotation(degrees(rotation));
    if (p.crop || p.margin) applyBox(copy, rotation, p.crop, p.margin);
    out.addPage(copy);
    const { width, height } = copy.getSize();
    lastSize = [width, height];
  }
  // İçindekiler ağacı: başlıklar yeni sayfa sırasına bağlanır; silinen sayfaya giden başlık düşer.
  const mapPage = new Map<number, number>();
  pages.forEach((p, i) => p.src === "main" && !mapPage.has(p.index) && mapPage.set(p.index, i));
  addOutline(out, remapOutline(outline, mapPage));
  out.setProducer("Çalışma Masası");
  return out.save();
}

function drawLined(page: PDFPage): void {
  const { width, height } = page.getSize();
  for (let y = height - 72; y > 48; y -= 24) page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 0.6, color: LINE });
}

function drawGrid(page: PDFPage): void {
  const { width, height } = page.getSize();
  const step = 14.17; // 5 mm
  for (let x = 0; x <= width; x += step) page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: 0.4, color: LINE });
  for (let y = 0; y <= height; y += step) page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.4, color: LINE });
}

/** Kırpma ve not alanı: görünen sayfaya göre verilir, PDF'in kendi koordinatlarına çevrilir. */
function applyBox(page: PDFPage, rotation: number, crop?: Rect, margin?: number): void {
  let box = page.getCropBox();
  const corners = (pts: [number, number][]) => {
    const g = { box, rotation };
    const pdf = pts.map(([x, y]) => viewToPdf(g, x, y));
    const xs = pdf.map((p) => p[0]);
    const ys = pdf.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };
  if (crop) {
    const [x, y, w, h] = crop;
    box = corners([[x, y], [x + w, y + h]]);
  }
  if (margin) box = corners([[0, 0], [1 + margin, 1]]);
  page.setMediaBox(box.x, box.y, box.width, box.height);
  page.setCropBox(box.x, box.y, box.width, box.height);
}

/** Asıl dosyanın sayfa numaralarını yeni sıraya çevir; karşılığı olmayan başlık alt başlıklarını üst düzeye bırakır. */
export function remapOutline(items: OutlineNode[], map: Map<number, number>): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const it of items) {
    const children = remapOutline(it.children, map);
    const page = it.page !== null ? map.get(it.page) : undefined;
    if (page !== undefined) out.push({ title: it.title, page, children });
    else out.push(...children);
  }
  return out;
}

function addOutline(doc: PDFDocument, items: OutlineNode[]): void {
  if (!items.length) return;
  const pageRefs = doc.getPages().map((p) => p.ref);
  const ctx = doc.context;
  const rootRef = ctx.nextRef();
  const build = (nodes: OutlineNode[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = nodes.map(() => ctx.nextRef());
    let count = 0;
    nodes.forEach((n, i) => {
      const dict = PDFDict.withContext(ctx);
      const d = dict as unknown as { set(k: PDFName, v: unknown): void };
      d.set(PDFName.of("Title"), PDFHexString.fromText(n.title));
      d.set(PDFName.of("Parent"), parent);
      d.set(PDFName.of("Dest"), ctx.obj([pageRefs[n.page!], PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull]));
      if (i > 0) d.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < nodes.length - 1) d.set(PDFName.of("Next"), refs[i + 1]);
      if (n.children.length) {
        const sub = build(n.children, refs[i]);
        d.set(PDFName.of("First"), sub.first);
        d.set(PDFName.of("Last"), sub.last);
        d.set(PDFName.of("Count"), PDFNumber.of(-sub.count)); // kapalı başlar
      }
      ctx.assign(refs[i], dict);
      count += 1;
    });
    return { first: refs[0], last: refs[refs.length - 1], count };
  };
  const top = build(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: "Outlines", First: top.first, Last: top.last, Count: top.count }));
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}
