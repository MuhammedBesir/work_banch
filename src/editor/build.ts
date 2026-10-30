import { PDFDocument, degrees, rgb, type PDFPage } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface Source {
  id: string;
  name: string;
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
}

const A4: [number, number] = [595.28, 841.89];
const LINE = rgb(0.81, 0.85, 0.89);

/** Sayfa listesinden yeni bir PDF üretir (pdf-lib, tamamen tarayıcıda). */
export async function buildPdf(pages: EditPage[], sources: Map<string, Pick<Source, "id" | "bytes">>): Promise<Uint8Array> {
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
    copy.setRotation(degrees((((base + p.rotation) % 360) + 360) % 360));
    out.addPage(copy);
    const { width, height } = copy.getSize();
    lastSize = [width, height];
  }
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
