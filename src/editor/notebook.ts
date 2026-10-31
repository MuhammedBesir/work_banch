import { PDFDocument } from "pdf-lib";
import { drawDots, drawGrid, drawLined } from "./build";

import type { Template } from "./templates";
export type { Template };

const A4: [number, number] = [595.28, 841.89];

/** Uygulamada yazmak için boş not defteri (pdf-lib, tarayıcıda). */
export async function createNotebook(template: Template, pages: number, landscape = false, title = "Not defteri"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("Çalışma Masası");
  for (let i = 0; i < pages; i++) addTemplatePage(doc, template, landscape ? [A4[1], A4[0]] : A4);
  return doc.save();
}

export function addTemplatePage(doc: PDFDocument, template: Template, size: [number, number]): void {
  const page = doc.addPage(size);
  if (template === "lined") drawLined(page);
  else if (template === "grid") drawGrid(page);
  else if (template === "dots") drawDots(page);
}

/** Not defterinin sonuna sayfa ekle ("sonsuz" defter): son sayfanın boyutu ve şablonuyla. */
export async function appendPages(bytes: Uint8Array, template: Template, count = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const last = doc.getPage(doc.getPageCount() - 1).getSize();
  for (let i = 0; i < count; i++) addTemplatePage(doc, template, [last.width, last.height]);
  return doc.save();
}
