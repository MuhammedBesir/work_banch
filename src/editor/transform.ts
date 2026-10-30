import { rotateRect } from "../geometry";
import type { Mark, Rect } from "../types";

// Düzenle modunda döndürülen, kırpılan ya da not alanı eklenen sayfanın vurgu ve işaretleri
// yeni sayfadaki yerlerine taşınır (hepsi sayfaya göre 0–1 koordinat).

export interface PageEdit {
  rotation: number;
  crop?: Rect;
  margin?: number;
}

export function editPoint([x, y]: [number, number], e: PageEdit): [number, number] {
  [x, y] = rotateRect([x, y, 0, 0], e.rotation);
  if (e.crop) {
    const [cx, cy, cw, ch] = e.crop;
    x = (x - cx) / cw;
    y = (y - cy) / ch;
  }
  if (e.margin) x /= 1 + e.margin;
  return [x, y];
}

/** Kırpılan alanın tamamen dışında kalan dikdörtgen düşer (null); kısmen kalanı kırpılır. */
export function editRect(r: Rect, e: PageEdit): Rect | null {
  let [x, y, w, h] = rotateRect(r, e.rotation);
  if (e.crop) {
    const [cx, cy, cw, ch] = e.crop;
    const x0 = Math.max(0, (x - cx) / cw);
    const y0 = Math.max(0, (y - cy) / ch);
    const x1 = Math.min(1, (x + w - cx) / cw);
    const y1 = Math.min(1, (y + h - cy) / ch);
    if (x1 <= x0 || y1 <= y0) return null;
    [x, y, w, h] = [x0, y0, x1 - x0, y1 - y0];
  }
  if (e.margin) [x, w] = [x / (1 + e.margin), w / (1 + e.margin)];
  return [x, y, w, h];
}

export function editMark<M extends Mark>(m: M, e: PageEdit): M | null {
  const inside = ([x, y]: [number, number]) => x >= -0.05 && x <= 1.05 && y >= -0.05 && y <= 1.05;
  if (m.kind === "ink") {
    const points = m.points.map((p) => editPoint(p, e));
    return points.some(inside) ? { ...m, points } : null;
  }
  if (m.kind === "shape") {
    const from = editPoint(m.from, e);
    const to = editPoint(m.to, e);
    return inside(from) || inside(to) ? { ...m, from, to } : null;
  }
  // Metin kutusu ve not okunur kalır: yalnızca sol üst köşesi taşınır, genişlik ölçeklenir.
  const box = (m as Extract<Mark, { box: Rect }>).box;
  const r = rotateRect(box, e.rotation);
  const origin = editPoint([r[0], r[1]], { ...e, rotation: 0 });
  const scale = (e.crop ? 1 / e.crop[2] : 1) / (1 + (e.margin ?? 0));
  const nb: Rect = [Math.min(Math.max(0, origin[0]), 0.98), Math.min(Math.max(0, origin[1]), 0.98), Math.min(1, box[2] * scale), box[3]];
  return { ...m, box: nb };
}
