import { rotateRect } from "../geometry";
import type { Mark, Rect } from "../types";

type Pt = [number, number];

/** Noktalardan yumuşatılmış SVG yolu (orta noktalar arası ikinci derece eğri). */
export function smoothPath(points: Pt[]): string {
  if (!points.length) return "";
  const f = (n: number) => +n.toFixed(5);
  if (points.length < 3) return `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L")}`;
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${f(last[0])} ${f(last[1])}`;
}

/** Ramer–Douglas–Peucker: el yazısını gözle görülür fark olmadan seyreltir. */
export function simplify(points: Pt[], tolerance = 0.0008): Pt[] {
  if (points.length < 3) return points;
  const sq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDistSq(points[i], points[a], points[b]);
      if (d > max) (max = d), (idx = i);
    }
    if (max > sq && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Noktanın doğru parçasına uzaklığının karesi. */
export function segDistSq([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** İşaretin sayfadaki kutusu (0–1). */
export function markBox(m: Mark): Rect {
  if (m.kind === "text" || m.kind === "sticky") return m.box;
  const pts = m.kind === "ink" ? m.points : [m.from, m.to];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

/**
 * Silgi ve seçim için isabet: nokta piksel cinsinden `tol` kadar yakın mı?
 * `w`, `h` sayfanın o anki piksel boyutu (sayfa oranı farklı eksenlerde farklı ölçeklenir).
 */
export function hitMark(m: Mark, x: number, y: number, w: number, h: number, tol = 8): boolean {
  const toPx = ([a, b]: Pt): Pt => [a * w, b * h];
  const p = toPx([x, y]);
  if (m.kind === "ink") {
    const pts = m.points.map(toPx);
    if (pts.length === 1) return segDistSq(p, pts[0], pts[0]) <= tol * tol;
    for (let i = 1; i < pts.length; i++) if (segDistSq(p, pts[i - 1], pts[i]) <= tol * tol) return true;
    return false;
  }
  if (m.kind === "shape") {
    const a = toPx(m.from);
    const b = toPx(m.to);
    if (m.shape === "arrow") return segDistSq(p, a, b) <= tol * tol;
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    if (m.shape === "rect") {
      const edges: [Pt, Pt][] = [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]];
      return edges.some(([e0, e1]) => segDistSq(p, e0, e1) <= tol * tol);
    }
    // elips: normalleştirilmiş yarıçap 1'e yakınsa kenardadır
    const rx = (x1 - x0) / 2 || 1;
    const ry = (y1 - y0) / 2 || 1;
    const k = Math.hypot((p[0] - (x0 + rx)) / rx, (p[1] - (y0 + ry)) / ry);
    return Math.abs(k - 1) * Math.min(rx, ry) <= tol;
  }
  const [bx, by, bw, bh] = m.box;
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

export function moveMark<M extends Mark>(m: M, dx: number, dy: number): M {
  const mv = ([x, y]: Pt): Pt => [x + dx, y + dy];
  if (m.kind === "ink") return { ...m, points: m.points.map(mv) };
  if (m.kind === "shape") return { ...m, from: mv(m.from), to: mv(m.to) };
  const [x, y, w, h] = (m as Extract<Mark, { box: Rect }>).box;
  return { ...m, box: [x + dx, y + dy, w, h] as Rect };
}

/** Düzenle modunda döndürülen sayfa: işaretler de sayfayla birlikte döner. */
export function rotateMark<M extends Mark>(m: M, degrees: number): M {
  const rp = ([x, y]: Pt): Pt => {
    const [rx, ry] = rotateRect([x, y, 0, 0], degrees);
    return [rx, ry];
  };
  if (m.kind === "ink") return { ...m, points: m.points.map(rp) };
  if (m.kind === "shape") return { ...m, from: rp(m.from), to: rp(m.to) };
  // Metin kutusu ve not okunur kalsın diye dönmez; yalnızca yeri taşınır.
  const box = (m as Extract<Mark, { box: Rect }>).box;
  const [nx, ny] = rotateRect(box, degrees);
  return { ...m, box: [nx, ny, box[2], box[3]] as Rect };
}

/** Okun ucu: sayfa oranına göre düzeltilmiş iki kanat noktası (0–1). */
export function arrowHead(from: Pt, to: Pt, aspect: number, size = 0.018): [Pt, Pt] {
  // y eksenini x ölçeğine çevir, açıyı hesapla, sonra geri çevir.
  const dx = to[0] - from[0];
  const dy = (to[1] - from[1]) * aspect;
  const ang = Math.atan2(dy, dx);
  const wing = (a: number): Pt => [to[0] - size * Math.cos(a), to[1] - (size * Math.sin(a)) / aspect];
  return [wing(ang - 0.45), wing(ang + 0.45)];
}
