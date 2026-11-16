import { describe, expect, it } from "vitest";
import { hitMark, recognizeShape, recognizedSize, scaleMark, shapePoly, tidyShape } from "../src/write/geometry";
import type { Mark } from "../src/types";

const W = 800;
const H = 1000;
type Pt = [number, number];
const px = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x / W, y / H]);
const seg = (a: Pt, b: Pt, n = 10): Pt[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n + Math.sin(i * 1.7) * 2, a[1] + ((b[1] - a[1]) * i) / n + Math.cos(i * 2.3) * 2]);

describe("şekil tanıma ve düzeltme", () => {
  it("titrek üçgen üç köşeli kapalı çokgen olur, tabanı yataylanır", () => {
    const r = recognizeShape(px([...seg([150, 80], [240, 220]), ...seg([240, 220], [60, 226]), ...seg([60, 226], [151, 83])]), W, H);
    expect(r?.type).toBe("poly");
    const t = tidyShape(r!, W, H);
    expect(t.type).toBe("poly");
    if (t.type !== "poly") return;
    expect(t.pts).toHaveLength(4);
    const ys = t.pts.map((p) => p[1] * H).sort((a, b) => b - a);
    expect(Math.abs(ys[0] - ys[1])).toBeLessThan(0.01); // taban tam yatay
  });
  it("neredeyse yuvarlak çizim tam daire olur", () => {
    const pts: Pt[] = Array.from({ length: 41 }, (_, i) => [400 + Math.cos((i / 40) * 2 * Math.PI) * 70, 150 + Math.sin((i / 40) * 2 * Math.PI) * 64]);
    const t = tidyShape(recognizeShape(px(pts), W, H)!, W, H);
    expect(t.type).toBe("ellipse");
    if (t.type !== "ellipse") return;
    expect(Math.abs((t.to[0] - t.from[0]) * W - (t.to[1] - t.from[1]) * H)).toBeLessThan(0.01);
  });
  it("neredeyse yatay çizgi tam yatay olur", () => {
    const t = tidyShape(recognizeShape(px(seg([80, 300], [330, 306], 14)), W, H)!, W, H);
    expect(t.type).toBe("line");
    if (t.type !== "line") return;
    expect(t.pts[0][1]).toBeCloseTo(t.pts[1][1], 6);
  });
  it("kenar ortalarına köşeli dörtgen eşkenar dörtgen olur", () => {
    const t = tidyShape(recognizeShape(px([...seg([200, 100], [300, 200]), ...seg([300, 200], [200, 300]), ...seg([200, 300], [100, 200]), ...seg([100, 200], [201, 102])]), W, H)!, W, H);
    expect(t.type).toBe("diamond");
  });
  it("karalama tanınmaz; küçük harf boyutu ölçülür", () => {
    expect(recognizeShape(px([[200, 400], [230, 440], [215, 410], [260, 445], [240, 400], [290, 450], [270, 405]]), W, H)).toBeNull();
    const o: Pt[] = Array.from({ length: 21 }, (_, i) => [100 + Math.cos((i / 20) * 2 * Math.PI) * 9, 420 + Math.sin((i / 20) * 2 * Math.PI) * 12]);
    const r = recognizeShape(px(o), W, H);
    expect(r && recognizedSize(r, W, H)).toBeLessThan(46); // otomatik düzeltme eşiğinin altında
  });
});

describe("yeni şekiller", () => {
  it("köşe sayıları doğru, kutunun içinde kalır", () => {
    const from: Pt = [0.2, 0.2];
    const to: Pt = [0.6, 0.5];
    expect(shapePoly("triangle", from, to)).toHaveLength(3);
    expect(shapePoly("diamond", from, to)).toHaveLength(4);
    expect(shapePoly("pentagon", from, to)).toHaveLength(5);
    expect(shapePoly("hexagon", from, to)).toHaveLength(6);
    expect(shapePoly("star", from, to)).toHaveLength(10);
    expect(shapePoly("rect", from, to)).toBeNull();
    for (const [x, y] of shapePoly("star", from, to)!) {
      expect(x).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(x).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(y).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
  it("üçgenin içi seçilir, dışı seçilmez", () => {
    const m = { id: "t", fileHash: "h", page: 0, kind: "shape", shape: "triangle", color: "blue", width: 2, from: [0.2, 0.2], to: [0.6, 0.6], createdAt: 0, updatedAt: 0 } as Mark;
    expect(hitMark(m, 0.4, 0.5, W, H, 8, true)).toBe(true);
    expect(hitMark(m, 0.22, 0.25, W, H, 8, true)).toBe(false); // kutunun içinde ama üçgenin dışında
  });
  it("yazı köşeden ölçeklenince harf boyutu değişir, kenardan uzatınca değişmez", () => {
    const m = { id: "x", fileHash: "h", page: 0, kind: "text", color: "blue", box: [0.1, 0.1, 0.3, 0.05], text: "a", size: 16, createdAt: 0, updatedAt: 0 } as Mark;
    expect((scaleMark(m, 0.1, 0.1, 2, 2) as { size: number }).size).toBe(32);
    expect((scaleMark(m, 0.1, 0.1, 2, 1) as { size: number }).size).toBe(16);
  });
});
