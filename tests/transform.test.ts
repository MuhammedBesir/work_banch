import { describe, expect, it } from "vitest";
import { editMark, editPoint, editRect } from "../src/editor/transform";
import { remapOutline } from "../src/editor/build";
import type { Mark } from "../src/types";

describe("Düzenle modu dönüşümleri", () => {
  it("kırpma: kutunun içine göre yeniden ölçekler, dışarıda kalanı düşürür", () => {
    const e = { rotation: 0, crop: [0.1, 0.1, 0.5, 0.5] as [number, number, number, number] };
    expect(editRect([0.2, 0.2, 0.1, 0.1], e)!.map((v) => +v.toFixed(3))).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(editRect([0.8, 0.8, 0.1, 0.1], e)).toBeNull();
    expect(editRect([0.5, 0.2, 0.3, 0.1], e)!.map((v) => +v.toFixed(3))).toEqual([0.8, 0.2, 0.2, 0.2]); // kısmen
  });
  it("not alanı: yatayda sıkışır, dikeyde aynı kalır", () => {
    expect(editPoint([0.5, 0.5], { rotation: 0, margin: 0.25 })).toEqual([0.4, 0.5]);
  });
  it("döndürme sonra kırpma", () => {
    const [x, y] = editPoint([0.1, 0.2], { rotation: 90, crop: [0, 0, 1, 0.5] });
    expect(x).toBeCloseTo(0.8);
    expect(y).toBeCloseTo(0.2);
  });
  it("işaretler: tamamen kırpılan çizim düşer, metin kutusu genişliği ölçeklenir", () => {
    const base = { id: "a", fileHash: "f", page: 0, createdAt: 0, updatedAt: 0 };
    const ink: Mark = { ...base, kind: "ink", color: "blue", width: 2, points: [[0.9, 0.9], [0.95, 0.95]] };
    expect(editMark(ink, { rotation: 0, crop: [0, 0, 0.5, 0.5] })).toBeNull();
    const text: Mark = { ...base, kind: "text", color: "blue", box: [0.1, 0.1, 0.2, 0.05], text: "x" };
    const t = editMark(text, { rotation: 0, crop: [0, 0, 0.5, 1] }) as typeof text;
    expect(t.box[0]).toBeCloseTo(0.2);
    expect(t.box[2]).toBeCloseTo(0.4);
  });
  it("içindekiler: silinen sayfanın başlığı düşer, alt başlıkları yukarı çıkar", () => {
    const out = remapOutline(
      [{ title: "Bölüm 1", page: 0, children: [{ title: "1.1", page: 2, children: [] }] }, { title: "Silinen", page: 5, children: [{ title: "Kalan", page: 6, children: [] }] }],
      new Map([[0, 0], [2, 1], [6, 3]]),
    );
    expect(out).toEqual([{ title: "Bölüm 1", page: 0, children: [{ title: "1.1", page: 1, children: [] }] }, { title: "Kalan", page: 3, children: [] }]);
  });
});
