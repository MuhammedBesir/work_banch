import { describe, expect, it } from "vitest";
import { arrowHead, hitMark, markBox, moveMark, rotateMark, simplify, smoothPath } from "../src/write/geometry";
import type { Mark } from "../src/types";

const base = { id: "a", fileHash: "f", page: 0, createdAt: 0, updatedAt: 0 };
const ink: Mark = { ...base, kind: "ink", color: "blue", width: 2, points: [[0.1, 0.1], [0.2, 0.1], [0.3, 0.1]] };

describe("Yaz modu geometrisi", () => {
  it("doğru üstündeki noktaları seyreltir, köşeyi korur", () => {
    expect(simplify([[0, 0], [0.5, 0], [1, 0], [1, 1]])).toEqual([[0, 0], [1, 0], [1, 1]]);
  });
  it("yumuşatılmış yol", () => {
    expect(smoothPath([[0, 0], [1, 1]])).toBe("M0 0 L1 1");
    expect(smoothPath([[0, 0], [0.5, 0.5], [1, 0]])).toBe("M0 0 Q0.5 0.5 0.75 0.25 L1 0");
  });
  it("silgi isabeti piksel toleransıyla", () => {
    expect(hitMark(ink, 0.2, 0.105, 600, 800)).toBe(true); // 4 px uzakta
    expect(hitMark(ink, 0.2, 0.13, 600, 800)).toBe(false); // 24 px uzakta
    const rect: Mark = { ...base, kind: "shape", shape: "rect", color: "red", width: 2, from: [0.1, 0.1], to: [0.5, 0.5] };
    expect(hitMark(rect, 0.3, 0.1, 600, 800)).toBe(true);
    expect(hitMark(rect, 0.3, 0.3, 600, 800)).toBe(false); // içi boş
  });
  it("kutu, taşıma, döndürme", () => {
    const b = markBox(ink);
    expect(b[0]).toBeCloseTo(0.1);
    expect(b[2]).toBeCloseTo(0.2);
    expect(b[3]).toBe(0);
    expect((moveMark(ink, 0.1, 0) as typeof ink).points[0][0]).toBeCloseTo(0.2);
    const r = rotateMark(ink, 90) as typeof ink;
    expect(r.points[0][0]).toBeCloseTo(0.9);
    expect(r.points[0][1]).toBeCloseTo(0.1);
    const text: Mark = { ...base, kind: "text", color: "blue", box: [0.1, 0.2, 0.3, 0.05], text: "x" };
    const rt = rotateMark(text, 90) as typeof text;
    expect(rt.box[2]).toBe(0.3); // metin kutusu okunur kalır, boyutu değişmez
  });
  it("ok ucu uca simetrik", () => {
    const [a, b] = arrowHead([0, 0.5], [1, 0.5], 1.41);
    expect(a[0]).toBeCloseTo(b[0]);
    expect(a[1] + b[1]).toBeCloseTo(1);
    expect(a[0]).toBeLessThan(1);
  });
});
