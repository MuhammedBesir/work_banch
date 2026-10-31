import { describe, expect, it } from "vitest";
import { eraseInk, inkSlope, pointInPolygon, recognizeShape, rotateAround, scaleMark } from "../src/write/geometry";
import { richPlain, toggleCheck } from "../src/write/rich";
import { inkRgb } from "../src/write/colors";
import type { Mark } from "../src/types";

const ink = (points: [number, number][]): Extract<Mark, { kind: "ink" }> =>
  ({ id: "a", fileHash: "f", page: 0, kind: "ink", color: "blue", width: 2, points, createdAt: 0, updatedAt: 0 });

describe("şekil tanıma", () => {
  const W = 600;
  const H = 800;
  it("düz çizgi", () => {
    const pts: [number, number][] = Array.from({ length: 20 }, (_, i) => [0.1 + i * 0.02, 0.5 + (i % 2) * 0.001]);
    expect(recognizeShape(pts, W, H)?.type).toBe("line");
  });
  it("daire → elips", () => {
    const pts: [number, number][] = [];
    for (let a = 0; a <= Math.PI * 2 + 0.2; a += 0.15) pts.push([0.5 + 0.1 * Math.cos(a), 0.5 + 0.075 * Math.sin(a)]);
    expect(recognizeShape(pts, W, H)?.type).toBe("ellipse");
  });
  it("kare → dikdörtgen, üçgen → çokgen", () => {
    const poly = (corners: [number, number][]) => {
      const out: [number, number][] = [];
      for (let i = 1; i < corners.length; i++) for (let t = 0; t <= 1; t += 0.1) out.push([corners[i - 1][0] + (corners[i][0] - corners[i - 1][0]) * t, corners[i - 1][1] + (corners[i][1] - corners[i - 1][1]) * t]);
      return out;
    };
    expect(recognizeShape(poly([[0.2, 0.2], [0.5, 0.2], [0.5, 0.4], [0.2, 0.4], [0.2, 0.2]]), W, H)?.type).toBe("rect");
    const tri = recognizeShape(poly([[0.2, 0.5], [0.35, 0.3], [0.5, 0.5], [0.2, 0.5]]), W, H);
    expect(tri?.type).toBe("poly");
    expect(tri && "pts" in tri ? tri.pts.length : 0).toBe(4);
  });
  it("karalama tanınmaz", () => {
    const pts: [number, number][] = Array.from({ length: 40 }, (_, i) => [0.3 + Math.sin(i * 1.7) * 0.05, 0.3 + i * 0.004]);
    expect(recognizeShape(pts, W, H)).toBeNull();
  });
});

describe("kısmi silgi", () => {
  it("ortadan silinen çizgi ikiye ayrılır", () => {
    const pieces = eraseInk(ink([[0.1, 0.5], [0.9, 0.5]]), 0.5, 0.5, 10, 1000, 1000);
    expect(pieces).toHaveLength(2);
    expect(pieces![0].points[0]).toEqual([0.1, 0.5]);
    expect(pieces![1].points.at(-1)).toEqual([0.9, 0.5]);
  });
  it("değmeyen silgi hiçbir şey yapmaz", () => {
    expect(eraseInk(ink([[0.1, 0.5], [0.9, 0.5]]), 0.5, 0.7, 10, 1000, 1000)).toBeNull();
  });
});

describe("seçim dönüşümleri", () => {
  it("ölçekleme köşeye göre", () => {
    const m = scaleMark(ink([[0.2, 0.2], [0.4, 0.4]]), 0.2, 0.2, 2, 2);
    expect(m.points[1][0]).toBeCloseTo(0.6);
  });
  it("eğik yazı düzleşir", () => {
    const m = ink([[0.1, 0.5], [0.3, 0.45], [0.5, 0.4]]);
    const ang = inkSlope([m], 1000, 1000);
    const flat = rotateAround(m, 0.3, 0.45, -ang, 1000, 1000) as typeof m;
    expect(Math.abs(flat.points[0][1] - flat.points[2][1])).toBeLessThan(1e-6);
  });
  it("kement içi", () => {
    expect(pointInPolygon([0.5, 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(true);
    expect(pointInPolygon([1.5, 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
  });
});

describe("biçimli not", () => {
  it("düz metne çevirir", () => {
    expect(richPlain("# Başlık\n**kalın** ve *italik*\n[ ] ödev\n[x] okuma\n| a | b |\n| --- | --- |\n| 1 | 2 |"))
      .toBe("Başlık\nkalın ve italik\n☐ ödev\n☑ okuma\na  |  b\n1  |  2");
  });
  it("yapılacak kutusunu çevirir", () => {
    expect(toggleCheck("x\n[ ] ödev", 1)).toBe("x\n[x] ödev");
    expect(toggleCheck("[x] ödev", 0)).toBe("[ ] ödev");
  });
  it("özel rengi çözer", () => {
    expect(inkRgb("#0f7b6c")).toEqual([15, 123, 108]);
    expect(inkRgb("blue")).toEqual([0x1f, 0x4e, 0x79]);
  });
});
