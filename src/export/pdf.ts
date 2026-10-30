import {
  BlendMode, degrees, PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFPage, PDFString, rgb, type RGB,
} from "pdf-lib";
import type { Color, Highlight, Mark, PenColor, Rect } from "../types";
import { arrowHead, smoothPath, strokeOutline } from "../write/geometry";
import { stickyLabel } from "../write/layer";

// Vurgulu / işaretli PDF: vurgular, notlar ve Yaz modu işaretleri PDF'e gömülür.
// Varsayılan düzleştirilmiş (her okuyucuda aynı görünür); istenirse düzenlenebilir standart PDF açıklamaları.

export type PdfMode = "flatten" | "annotations";

export interface PdfExportOptions {
  mode: PdfMode;
  colors: Set<Color>;
  withNotes: boolean;
  withWriting: boolean;
  names: Record<Color, string>;
}

const HL: Record<Color, [number, number, number]> = {
  1: [0xf5, 0xd7, 0x6e],
  2: [0xf2, 0xa4, 0x8f],
  3: [0xa9, 0xcb, 0xec],
  4: [0xbd, 0xdb, 0xa6],
};
const PEN: Record<PenColor, [number, number, number]> = { black: [0x1f, 0x1d, 0x1a], blue: [0x1f, 0x4e, 0x79], red: [0xa3, 0x22, 0x1a] };
const STICKY: [number, number, number] = [0xf3, 0xe7, 0xc4];
const INK = "#1f1d1a";

const toRgb = ([r, g, b]: [number, number, number]): RGB => rgb(r / 255, g / 255, b / 255);
const toUnit = ([r, g, b]: [number, number, number]) => [r / 255, g / 255, b / 255];
const css = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

/**
 * Sayfanın görünen (döndürülmüş) koordinatlarından PDF kullanıcı uzayına.
 * Uygulamadaki işaretler pdf.js görünümüne göre 0–1; sayfa döndürülmüşse PDF uzayı farklıdır.
 */
export function viewToPdf(page: { box: { x: number; y: number; width: number; height: number }; rotation: number }, nx: number, ny: number): [number, number] {
  const { x, y, width: w, height: hgt } = page.box;
  switch (((page.rotation % 360) + 360) % 360) {
    case 90:
      return [x + ny * w, y + nx * hgt];
    case 180:
      return [x + (1 - nx) * w, y + ny * hgt];
    case 270:
      return [x + (1 - ny) * w, y + (1 - nx) * hgt];
    default:
      return [x + nx * w, y + (1 - ny) * hgt];
  }
}

interface PageGeom {
  page: PDFPage;
  box: { x: number; y: number; width: number; height: number };
  rotation: number;
  /** Görünen (döndürülmüş) genişlik ve yükseklik, nokta. */
  vw: number;
  vh: number;
}

function geom(page: PDFPage): PageGeom {
  const box = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const quarter = rotation % 180 !== 0;
  return { page, box, rotation, vw: quarter ? box.height : box.width, vh: quarter ? box.width : box.height };
}

/** Görünen dikdörtgenin PDF uzayındaki sınırlayıcı kutusu [x0, y0, x1, y1]. */
function rectToPdf(g: PageGeom, [x, y, w, hh]: Rect): [number, number, number, number] {
  const a = viewToPdf(g, x, y);
  const b = viewToPdf(g, x + w, y + hh);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** SVG yolu (0–1 görünen koordinat) → PDF uzayında yol; pdf-lib drawSvgPath y'yi aşağı doğru alır. */
function pathToPdf(g: PageGeom, d: string): string {
  return d.replace(/(-?\d*\.?\d+(?:e-?\d+)?)\s+(-?\d*\.?\d+(?:e-?\d+)?)/g, (_, a, b) => {
    const [px, py] = viewToPdf(g, Number(a), Number(b));
    return `${px.toFixed(2)} ${(-py).toFixed(2)}`;
  });
}

export async function exportAnnotatedPdf(source: Uint8Array, highlights: Highlight[], marks: Mark[], o: PdfExportOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  const pages = doc.getPages().map(geom);
  const hls = highlights.filter((x) => o.colors.has(x.color) && pages[x.page]);
  const writing = o.withWriting ? marks.filter((m) => pages[m.page]) : [];

  for (const h of hls) {
    const g = pages[h.page];
    if (o.mode === "flatten") {
      for (const r of h.rects) {
        const [x0, y0, x1, y1] = rectToPdf(g, r);
        g.page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, color: toRgb(HL[h.color]), blendMode: BlendMode.Multiply });
      }
      // Not: düzleştirilmiş modda da standart açıklama balonu (her okuyucuda görünür bir simge).
      if (o.withNotes && h.note.trim()) addTextNote(doc, g, h.rects[0], `${o.names[h.color]}: ${h.note.trim()}`, HL[h.color]);
    } else {
      addHighlightAnnot(doc, g, h, o.withNotes ? h.note.trim() : "", o.names[h.color]);
    }
  }

  for (const m of writing) {
    const g = pages[m.page];
    if (m.kind === "ink" || m.kind === "shape") {
      if (o.mode === "annotations") addDrawingAnnot(doc, g, m);
      else drawFlat(g, m);
    } else if (m.text.trim()) {
      if (m.kind === "sticky" && (o.mode === "annotations" || m.collapsed)) {
        addTextNote(doc, g, m.box, `${stickyLabel(m)}: ${m.text.trim()}`, STICKY);
      } else {
        await drawTextImage(doc, g, m);
      }
    }
  }
  doc.setProducer("Çalışma Masası");
  return doc.save();
}

// ---------- Düzleştirilmiş çizim ----------

function drawFlat(g: PageGeom, m: Extract<Mark, { kind: "ink" | "shape" }>): void {
  const color = toRgb(PEN[m.color]);
  const draw = (d: string, fill = false) =>
    g.page.drawSvgPath(pathToPdf(g, d), { x: 0, y: 0, ...(fill ? { color, borderWidth: 0 } : { borderColor: color, borderWidth: m.width, borderLineCap: 1 }) });
  if (m.kind === "ink") {
    if (m.pressures?.length === m.points.length && m.points.length > 1) draw(strokeOutline(m.points, m.pressures, m.width, g.vw, g.vh), true);
    else draw(smoothPath(m.points));
    return;
  }
  const [x0, y0] = m.from;
  const [x1, y1] = m.to;
  if (m.shape === "rect") draw(`M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z`);
  else if (m.shape === "ellipse") draw(ellipseD(x0, y0, x1, y1, g.vw, g.vh));
  else {
    const [a, b] = arrowHead(m.from, m.to, g.vh / g.vw);
    draw(`M${x0} ${y0} L${x1} ${y1} M${a[0]} ${a[1]} L${x1} ${y1} L${b[0]} ${b[1]}`);
  }
}

/** Elips: dönüşte bozulmasın diye çokgen. */
function ellipseD(x0: number, y0: number, x1: number, y1: number, w: number, h: number): string {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  const n = Math.max(24, Math.round((rx * w + ry * h) / 4));
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return `${cx + rx * Math.cos(t)} ${cy + ry * Math.sin(t)}`;
  });
  return `M${pts.join(" L")} Z`;
}

/**
 * Metin kutusu ve açık yapışkan not görüntü olarak gömülür: PDF'in standart yazı tiplerinde
 * ş, ğ, ı, İ yok; görüntü her okuyucuda harfi harfine aynı görünür.
 */
async function drawTextImage(doc: PDFDocument, g: PageGeom, m: Extract<Mark, { kind: "text" | "sticky" }>): Promise<void> {
  const S = 3;
  const wPt = m.box[2] * g.vw;
  const sticky = m.kind === "sticky";
  const pad = sticky ? 12 : 6;
  const size = 14;
  const line = sticky ? 21 : 20;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = sticky ? `400 ${size * S}px "Source Serif 4", Georgia, serif` : `500 ${size * S}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.font = font;
  const maxW = (wPt - pad * 2) * S;
  const lines: string[] = [];
  if (sticky) lines.push(`${stickyLabel(m as Extract<Mark, { kind: "sticky" }>)} · s. ${m.page + 1}`);
  for (const para of m.text.split(/\n/)) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    lines.push(cur);
  }
  const hPt = pad * 2 + lines.length * line;
  canvas.width = Math.ceil(wPt * S);
  canvas.height = Math.ceil(hPt * S);
  if (sticky) {
    ctx.fillStyle = css(STICKY);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.textBaseline = "top";
  lines.forEach((l, i) => {
    const header = sticky && i === 0;
    ctx.font = header ? `500 ${11 * S}px "IBM Plex Sans", system-ui, sans-serif` : font;
    ctx.fillStyle = header ? "#57524a" : sticky ? INK : css(PEN[(m as Extract<Mark, { kind: "text" }>).color]);
    ctx.fillText(l, pad * S, (pad + i * line + (line - size) / 2) * S);
  });
  const png = await doc.embedPng(await new Promise<Uint8Array>((resolve) =>
    canvas.toBlob(async (b) => resolve(new Uint8Array(await b!.arrayBuffer())), "image/png")));
  const [x0, y0, x1, y1] = rectToPdf(g, [m.box[0], m.box[1], m.box[2], hPt / g.vh]);
  const rot = g.rotation;
  // Döndürülmüş sayfada görüntü de sayfayla birlikte döner, okunur kalır.
  if (rot === 0) g.page.drawImage(png, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  else {
    const [ax, ay] = viewToPdf(g, m.box[0], m.box[1] + hPt / g.vh);
    g.page.drawImage(png, { x: ax, y: ay, width: wPt, height: hPt, rotate: degrees(rot) });
  }
}

// ---------- Düzenlenebilir açıklamalar ----------

function addAnnot(doc: PDFDocument, page: PDFPage, dict: Record<string, unknown>): void {
  const ref = doc.context.register(doc.context.obj(dict as never));
  const existing = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}

const nowDate = () => PDFString.fromDate(new Date());

function addHighlightAnnot(doc: PDFDocument, g: PageGeom, h: Highlight, note: string, name: string): void {
  const boxes = h.rects.map((r) => rectToPdf(g, r));
  const rect = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  // QuadPoints: sol üst, sağ üst, sol alt, sağ alt (PDF 1.7 okuyucu alışkanlığı).
  const quads = boxes.flatMap(([x0, y0, x1, y1]) => [x0, y1, x1, y1, x0, y0, x1, y0]);
  addAnnot(doc, g.page, {
    Type: "Annot", Subtype: "Highlight", Rect: rect, QuadPoints: quads, C: toUnit(HL[h.color]), CA: PDFNumber.of(1),
    Contents: PDFHexString.fromText(note ? `${name}: ${note}` : name), T: PDFHexString.fromText("Çalışma Masası"), M: nowDate(), F: 4,
  });
}

function addTextNote(doc: PDFDocument, g: PageGeom, at: Rect, text: string, color: [number, number, number]): void {
  const [x0, , , y1] = rectToPdf(g, at);
  addAnnot(doc, g.page, {
    Type: "Annot", Subtype: "Text", Rect: [x0 - 22, y1 - 18, x0 - 4, y1], Name: "Comment", C: toUnit(color),
    Contents: PDFHexString.fromText(text), T: PDFHexString.fromText("Çalışma Masası"), M: nowDate(), F: 4, Open: false,
  });
}

function addDrawingAnnot(doc: PDFDocument, g: PageGeom, m: Extract<Mark, { kind: "ink" | "shape" }>): void {
  const pts = m.kind === "ink" ? m.points : [m.from, m.to];
  const pdf = pts.map(([x, y]) => viewToPdf(g, x, y));
  const pad = m.width + 2;
  const rect = [Math.min(...pdf.map((p) => p[0])) - pad, Math.min(...pdf.map((p) => p[1])) - pad, Math.max(...pdf.map((p) => p[0])) + pad, Math.max(...pdf.map((p) => p[1])) + pad];
  const base = { Type: "Annot", Rect: rect, C: toUnit(PEN[m.color]), BS: { W: m.width }, T: PDFHexString.fromText("Çalışma Masası"), M: nowDate(), F: 4 };
  if (m.kind === "ink") {
    addAnnot(doc, g.page, { ...base, Subtype: "Ink", InkList: [pdf.flat()] });
  } else if (m.shape === "arrow") {
    addAnnot(doc, g.page, { ...base, Subtype: "Line", L: pdf.flat(), LE: [PDFName.of("None"), PDFName.of("OpenArrow")] });
  } else {
    const [x0, y0, x1, y1] = [Math.min(pdf[0][0], pdf[1][0]), Math.min(pdf[0][1], pdf[1][1]), Math.max(pdf[0][0], pdf[1][0]), Math.max(pdf[0][1], pdf[1][1])];
    addAnnot(doc, g.page, { ...base, Rect: [x0 - pad, y0 - pad, x1 + pad, y1 + pad], RD: [pad, pad, pad, pad], Subtype: m.shape === "rect" ? "Square" : "Circle" });
  }
}
