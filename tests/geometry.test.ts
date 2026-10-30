import { describe, expect, it } from "vitest";
import { mergeRects, normalizeRects, pointInRects, readingOrder, rotateRect } from "../src/geometry";
import type { Rect } from "../src/types";

const dom = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRectReadOnly;

describe("normalizeRects", () => {
  it("sayfa kutusuna göre 0–1 aralığına çevirir ve aynı satırı birleştirir", () => {
    const page = dom(100, 50, 600, 800);
    const out = normalizeRects([dom(160, 130, 60, 16), dom(220, 130, 120, 16)], page);
    expect(out).toHaveLength(1);
    const [x, y, w, h] = out[0];
    expect(x).toBeCloseTo(0.1);
    expect(y).toBeCloseTo(0.1);
    expect(w).toBeCloseTo(0.3);
    expect(h).toBeCloseTo(0.02);
  });

  it("sayfa dışına taşan ve boş kutuları atar", () => {
    const page = dom(0, 0, 100, 100);
    expect(normalizeRects([dom(200, 10, 20, 10), dom(10, 10, 0, 10)], page)).toEqual([]);
    const clipped = normalizeRects([dom(90, 10, 30, 10)], page);
    expect(clipped[0][2]).toBeCloseTo(0.1);
  });
});

describe("mergeRects", () => {
  it("farklı satırları ayrı tutar", () => {
    const rects: Rect[] = [[0.1, 0.1, 0.2, 0.02], [0.1, 0.13, 0.3, 0.02]];
    expect(mergeRects(rects)).toHaveLength(2);
  });
});

describe("rotateRect", () => {
  const r: Rect = [0.1, 0.2, 0.3, 0.05];
  it("90° saat yönünde döndürür", () => {
    const [x, y, w, h] = rotateRect(r, 90);
    expect([x, y, w, h].map((v) => +v.toFixed(4))).toEqual([0.75, 0.1, 0.05, 0.3]);
  });
  it("dört çeyrek dönüş başa döner", () => {
    let cur = r;
    for (let i = 0; i < 4; i++) cur = rotateRect(cur, 90);
    cur.forEach((v, i) => expect(v).toBeCloseTo(r[i]));
  });
  it("180° ve 270° tutarlı", () => {
    const a = rotateRect(rotateRect(r, 90), 180);
    rotateRect(r, 270).forEach((v, i) => expect(v).toBeCloseTo(a[i]));
  });
});

describe("pointInRects / readingOrder", () => {
  it("noktayı bulur", () => {
    expect(pointInRects(0.2, 0.21, [[0.1, 0.2, 0.3, 0.05]])).toBe(true);
    expect(pointInRects(0.5, 0.21, [[0.1, 0.2, 0.3, 0.05]])).toBe(false);
  });
  it("önce sayfa, sonra üstten alta, sonra soldan sağa", () => {
    const a = { page: 1, rects: [[0.5, 0.1, 0.1, 0.02]] as Rect[] };
    const b = { page: 1, rects: [[0.1, 0.1, 0.1, 0.02]] as Rect[] };
    const c = { page: 0, rects: [[0.1, 0.9, 0.1, 0.02]] as Rect[] };
    expect([a, b, c].sort(readingOrder)).toEqual([c, b, a]);
  });
});
