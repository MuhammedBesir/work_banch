import { rotateRect } from "../geometry";
import type { Mark, PenKind, Rect } from "../types";

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
  return simplifyIndices(points, tolerance).map((i) => points[i]);
}

/** Seyreltmede tutulan noktaların sırası (basınç dizisi de aynı noktalarla seyrelsin diye). */
export function simplifyIndices(points: Pt[], tolerance = 0.0008): number[] {
  if (points.length < 3) return points.map((_, i) => i);
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
  return points.map((_, i) => i).filter((i) => keep[i]);
}

/**
 * Basınca duyarlı çizgi: noktalar boyunca kalınlığı değişen dolu bir şekil (0–1 koordinat).
 * `widthPx` ölçek 1'deki kalınlık; `w`, `h` sayfanın ölçek 1'deki boyutu.
 */
export function strokeOutline(points: Pt[], pressures: number[], widthPx: number, w: number, h: number): string {
  if (points.length < 2) return "";
  const px = points.map(([x, y]) => [x * w, y * h] as Pt);
  const half = (i: number) => (widthPx * (0.35 + 1.3 * (pressures[i] ?? 0.5))) / 2;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < px.length; i++) {
    const a = px[Math.max(0, i - 1)];
    const b = px[Math.min(px.length - 1, i + 1)];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const r = half(i);
    left.push([(px[i][0] + nx * r) / w, (px[i][1] + ny * r) / h]);
    right.push([(px[i][0] - nx * r) / w, (px[i][1] - ny * r) / h]);
  }
  const f = (n: number) => +n.toFixed(5);
  const ring = [...left, ...right.reverse()];
  return `M${ring.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L")} Z`;
}

/** Shift: şekil kare/daire olur, ok ve çizgi 45°'lik açılara oturur (piksel uzayında). */
export function constrain(from: Pt, to: Pt, kind: "rect" | "ellipse" | "arrow", w: number, h: number): Pt {
  const dx = (to[0] - from[0]) * w;
  const dy = (to[1] - from[1]) * h;
  if (kind === "arrow") {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [from[0] + (Math.cos(ang) * len) / w, from[1] + (Math.sin(ang) * len) / h];
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [from[0] + (Math.sign(dx || 1) * side) / w, from[1] + (Math.sign(dy || 1) * side) / h];
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
  if (m.kind === "text" || m.kind === "sticky" || m.kind === "image") return m.box;
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

// ---------- Kalem türleri ----------

/** Kalem türünün çizgi kalınlığı (ölçek 1, px) ve saydamlığı. */
export function penStyle(pen: PenKind, width: number): { width: number; opacity: number } {
  switch (pen) {
    case "pencil": return { width: Math.max(0.8, width * 0.8), opacity: 0.78 };
    case "marker": return { width: Math.max(10, width * 6), opacity: 0.38 };
    case "fountain": return { width: width * 1.6, opacity: 1 };
    default: return { width, opacity: 1 };
  }
}

/**
 * Çizgi boyunca kalınlık: dolma kalemde 45°'lik uç yönden gelir (yatay ince, dikey kalın değil, çapraz fark),
 * diğerlerinde kalem basıncı (varsa). `null`: sabit kalınlık.
 */
export function inkPressures(m: Extract<Mark, { kind: "ink" }>, w: number, h: number): number[] | null {
  if (m.pen === "marker" || m.straight) return null;
  if (m.pen === "fountain" && m.points.length > 1) {
    return m.points.map((_, i) => {
      const a = m.points[Math.max(0, i - 1)];
      const b = m.points[Math.min(m.points.length - 1, i + 1)];
      const ang = Math.atan2((b[1] - a[1]) * h, (b[0] - a[0]) * w);
      return +(0.08 + 0.75 * Math.abs(Math.sin(ang - Math.PI / 4))).toFixed(2);
    });
  }
  return m.pressures?.length === m.points.length && m.points.length > 1 ? m.pressures : null;
}

/** Şekil tanımadan gelen köşeli çizgi. */
export function straightPath(points: Pt[]): string {
  const f = (n: number) => +n.toFixed(5);
  return `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L")}`;
}

// ---------- Kısmi silgi ----------

/** Noktaları en fazla `stepPx` aralıkla sıklaştır (silgi seyrek noktalar arasından da kesebilsin). */
export function densify(points: Pt[], pressures: number[] | undefined, stepPx: number, w: number, h: number): { points: Pt[]; pressures?: number[] } {
  const out: Pt[] = [];
  const pr: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const n = Math.floor(Math.hypot((bx - ax) * w, (by - ay) * h) / stepPx);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        if (pressures) pr.push(pressures[i - 1] + (pressures[i] - pressures[i - 1]) * t);
      }
    }
    out.push(points[i]);
    if (pressures) pr.push(pressures[i]);
  }
  return pressures ? { points: out, pressures: pr } : { points: out };
}

/**
 * Silginin değdiği kısmı çizgiden çıkar. Değmediyse `null`; değdiyse kalan parçalar
 * (her biri en az iki nokta; hiç kalmadıysa boş dizi).
 */
export function eraseInk(m: Extract<Mark, { kind: "ink" }>, x: number, y: number, radiusPx: number, w: number, h: number): { points: Pt[]; pressures?: number[] }[] | null {
  const dense = densify(m.points, m.pressures?.length === m.points.length ? m.pressures : undefined, Math.max(1, radiusPx / 2), w, h);
  const r2 = radiusPx * radiusPx;
  const inside = dense.points.map(([px, py]) => ((px - x) * w) ** 2 + ((py - y) * h) ** 2 <= r2);
  if (!inside.some(Boolean)) return null;
  const pieces: { points: Pt[]; pressures?: number[] }[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length > 1) {
      pieces.push({ points: cur.map((i) => dense.points[i]), ...(dense.pressures ? { pressures: cur.map((i) => +dense.pressures![i].toFixed(2)) } : {}) });
    }
    cur = [];
  };
  inside.forEach((hit, i) => (hit ? flush() : cur.push(i)));
  flush();
  return pieces;
}

// ---------- Kement ----------

export function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Kementin içinde mi: çizgilerde noktaların yarısından fazlası, diğerlerinde kutunun ortası. */
export function inLasso(m: Mark, poly: Pt[]): boolean {
  if (m.kind === "ink") return m.points.filter((p) => pointInPolygon(p, poly)).length > m.points.length / 2;
  const [x, y, w, h] = markBox(m);
  return pointInPolygon([x + w / 2, y + h / 2], poly);
}

/** Birden çok işaretin ortak kutusu. */
export function unionBox(marks: Mark[]): Rect | null {
  if (!marks.length) return null;
  const boxes = marks.map(markBox);
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** `(ox, oy)` noktasına göre ölçekle (seçim kutusunun köşe tutamacı). */
export function scaleMark<M extends Mark>(m: M, ox: number, oy: number, sx: number, sy: number): M {
  const sp = ([x, y]: Pt): Pt => [ox + (x - ox) * sx, oy + (y - oy) * sy];
  if (m.kind === "ink") return { ...m, points: m.points.map(sp), width: m.width } as M;
  if (m.kind === "shape") return { ...m, from: sp(m.from), to: sp(m.to) } as M;
  const [x, y, w, h] = (m as Extract<Mark, { box: Rect }>).box;
  const [nx, ny] = sp([x, y]);
  if (m.kind === "sticky") return { ...m, box: [nx, ny, w, h] as Rect };
  if (m.kind === "text") return { ...m, box: [nx, ny, w * sx, h * sy] as Rect, size: Math.max(6, Math.round((m.size ?? 14) * Math.sqrt(sx * sy))) } as M;
  return { ...m, box: [nx, ny, w * sx, h * sy] as Rect };
}

// ---------- Şekil tanıma ----------

export type Recognized =
  | { type: "line"; pts: [Pt, Pt] }
  | { type: "poly"; pts: Pt[] }
  | { type: "rect" | "ellipse"; from: Pt; to: Pt };

/**
 * Elle çizilen şekli tanı (Samsung Notes'taki "çiz ve bekle"): düz çizgi, üçgen, dörtgen, dikdörtgen, elips.
 * Noktalar 0–1, `w`, `h` sayfanın piksel boyutu. Tanınmazsa `null`.
 */
export function recognizeShape(points: Pt[], w: number, h: number): Recognized | null {
  if (points.length < 2) return null;
  const px = points.map(([x, y]) => [x * w, y * h] as Pt);
  let len = 0;
  for (let i = 1; i < px.length; i++) len += Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1]);
  if (len < 24) return null;
  const back = (p: Pt): Pt => [p[0] / w, p[1] / h];
  const first = px[0];
  const last = px[px.length - 1];
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  // Düz çizgi: uçlar arası uzaklık yol uzunluğuna yakın ve sapma küçük.
  if (chord / len > 0.9) {
    const dev = Math.max(...px.map((p) => Math.sqrt(segDistSq(p, first, last))));
    if (dev < Math.max(5, chord * 0.07)) return { type: "line", pts: [back(first), back(last)] };
  }
  const xs = px.map((p) => p[0]);
  const ys = px.map((p) => p[1]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const diag = Math.hypot(bx1 - bx0, by1 - by0);
  // Kapalı değilse tanınmaz.
  if (chord > Math.max(diag * 0.25, 18) || diag < 20) return null;
  const closed = [...px, first];
  const corners = simplifyIndices(closed, diag * 0.075).map((i) => closed[i]);
  // Uç noktayı başlangıçla birleştir, birbirine çok yakın köşeleri at.
  const verts: Pt[] = [];
  for (const c of corners.slice(0, -1)) {
    if (!verts.length || Math.hypot(c[0] - verts[verts.length - 1][0], c[1] - verts[verts.length - 1][1]) > diag * 0.12) verts.push(c);
  }
  if (verts.length > 2 && Math.hypot(verts[0][0] - verts[verts.length - 1][0], verts[0][1] - verts[verts.length - 1][1]) < diag * 0.12) verts.pop();
  const rx = (bx1 - bx0) / 2 || 1;
  const ry = (by1 - by0) / 2 || 1;
  const cx = bx0 + rx;
  const cy = by0 + ry;
  const ellipseErr = px.reduce((s, [x, y]) => s + Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1), 0) / px.length;
  const box = { from: back([bx0, by0]), to: back([bx1, by1]) };
  if (verts.length === 3 && ellipseErr > 0.08) return { type: "poly", pts: [...verts, verts[0]].map(back) };
  if (verts.length === 4 && ellipseErr > 0.06) {
    const axis = verts.every((v, i) => {
      const n = verts[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(n[1] - v[1], n[0] - v[0])) % (Math.PI / 2);
      return Math.min(ang, Math.PI / 2 - ang) < 0.22;
    });
    return axis ? { type: "rect", ...box } : { type: "poly", pts: [...verts, verts[0]].map(back) };
  }
  if (ellipseErr < 0.16) return { type: "ellipse", ...box };
  return null;
}

// ---------- El yazısını düzleştirme ----------

/** Çizgilerin genel eğimi (radyan, piksel uzayında; en küçük kareler). */
export function inkSlope(marks: Mark[], w: number, h: number): number {
  const pts = marks.flatMap((m) => (m.kind === "ink" ? m.points : [])).map(([x, y]) => [x * w, y * h] as Pt);
  if (pts.length < 2) return 0;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den ? Math.atan(num / den) : 0;
}

/** İşareti `(cx, cy)` (0–1) etrafında döndür; kutulu işaretlerin yalnızca yeri döner. */
export function rotateAround<M extends Mark>(m: M, cx: number, cy: number, ang: number, w: number, h: number): M {
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const rp = ([x, y]: Pt): Pt => {
    const dx = (x - cx) * w;
    const dy = (y - cy) * h;
    return [cx + (dx * cos - dy * sin) / w, cy + (dx * sin + dy * cos) / h];
  };
  if (m.kind === "ink") return { ...m, points: m.points.map(rp) };
  if (m.kind === "shape") {
    const c = rp([(m.from[0] + m.to[0]) / 2, (m.from[1] + m.to[1]) / 2]);
    const dx = c[0] - (m.from[0] + m.to[0]) / 2;
    const dy = c[1] - (m.from[1] + m.to[1]) / 2;
    return moveMark(m, dx, dy);
  }
  const [x, y, bw, bh] = markBox(m);
  const c = rp([x + bw / 2, y + bh / 2]);
  return moveMark(m, c[0] - (x + bw / 2), c[1] - (y + bh / 2));
}
