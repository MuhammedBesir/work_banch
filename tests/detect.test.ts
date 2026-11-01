import { describe, expect, it } from "vitest";
import { garbledRatio, subtractBoxes, uncoveredInk } from "../src/ocr/detect";

describe("OCR ihtiyacı", () => {
  it("normal metin bozuk sayılmaz", () => {
    expect(garbledRatio("Normal dağılım, ortalama ve standart sapma ile belirlenir.")).toBeLessThan(0.1);
  });
  it("özel kullanım alanı ve sembol yığını bozuk sayılır", () => {
    expect(garbledRatio(" ")).toBeGreaterThan(0.9);
    expect(garbledRatio("#$%&'()*+,#$%&'()*+,-./")).toBeGreaterThan(0.5);
  });
  it("metin kutusu dışındaki mürekkep ölçülür", () => {
    const w = 10, h = 10;
    const ink = new Uint8Array(w * h);
    for (let x = 0; x < 10; x++) { ink[x] = 1; ink[90 + x] = 1; } // üst ve alt satır
    const half = uncoveredInk(ink, w, h, [[0, 0, 1, 0.1]], 0);
    expect(half.ratio).toBeCloseTo(0.5);
    expect(uncoveredInk(ink, w, h, [[0, 0, 1, 1]], 0).ratio).toBe(0);
  });
  it("PDF metniyle çakışan OCR kelimeleri atılır", () => {
    const ocr = {
      lines: [[{ t: "var", b: [0.1, 0.1, 0.2, 0.12] as [number, number, number, number] }, { t: "resimde", b: [0.5, 0.5, 0.6, 0.52] as [number, number, number, number] }]],
      text: "var resimde",
      confidence: 90,
    };
    const out = subtractBoxes(ocr, [[0.09, 0.09, 0.3, 0.13]]);
    expect(out.text).toBe("resimde");
  });
});
