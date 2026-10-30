import type { Rect } from "./types";

/** İstemci dikdörtgenlerini sayfa kutusuna göre 0–1 aralığına çevirir. */
export function normalizeRects(rects: Iterable<DOMRectReadOnly>, page: DOMRectReadOnly): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    if (r.width < 1 || r.height < 1) continue;
    const x = Math.max(r.left, page.left);
    const y = Math.max(r.top, page.top);
    const right = Math.min(r.right, page.right);
    const bottom = Math.min(r.bottom, page.bottom);
    if (right <= x || bottom <= y) continue;
    out.push([
      (x - page.left) / page.width,
      (y - page.top) / page.height,
      (right - x) / page.width,
      (bottom - y) / page.height,
    ]);
  }
  return mergeRects(out);
}

/**
 * Aynı satırdaki örtüşen ya da bitişik dikdörtgenleri birleştirir.
 * PDF metin katmanı her kelime parçası için ayrı kutu verir; birleştirmeden vurgu yamalı görünür.
 */
export function mergeRects(rects: Rect[], gap = 0.006): Rect[] {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const lines: Rect[] = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    if (last && sameLine(last, r) && r[0] <= last[0] + last[2] + gap) {
      const x = Math.min(last[0], r[0]);
      const y = Math.min(last[1], r[1]);
      const right = Math.max(last[0] + last[2], r[0] + r[2]);
      const bottom = Math.max(last[1] + last[3], r[1] + r[3]);
      lines[lines.length - 1] = [x, y, right - x, bottom - y];
    } else {
      lines.push(r);
    }
  }
  return lines;
}

function sameLine(a: Rect, b: Rect): boolean {
  const overlap = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return overlap > Math.min(a[3], b[3]) * 0.5;
}

/** Sayfa saat yönünde döndürüldüğünde normalleştirilmiş dikdörtgenin yeni yeri. */
export function rotateRect([x, y, w, h]: Rect, degrees: number): Rect {
  switch (((degrees % 360) + 360) % 360) {
    case 90:
      return [1 - y - h, x, h, w];
    case 180:
      return [1 - x - w, 1 - y - h, w, h];
    case 270:
      return [y, 1 - x - w, h, w];
    default:
      return [x, y, w, h];
  }
}

export function pointInRects(px: number, py: number, rects: Rect[], pad = 0): boolean {
  return rects.some(([x, y, w, h]) => px >= x - pad && px <= x + w + pad && py >= y - pad && py <= y + h + pad);
}

/** Vurguların sayfadaki okuma sırası: önce üstten alta, sonra soldan sağa. */
export function readingOrder(a: { page: number; rects: Rect[] }, b: { page: number; rects: Rect[] }): number {
  if (a.page !== b.page) return a.page - b.page;
  const ay = a.rects[0]?.[1] ?? 0;
  const by = b.rects[0]?.[1] ?? 0;
  if (Math.abs(ay - by) > 0.004) return ay - by;
  return (a.rects[0]?.[0] ?? 0) - (b.rects[0]?.[0] ?? 0);
}
