import { describe, expect, it } from "vitest";
import { hasMath, mathToPlain } from "../src/ui/math";

describe("AI cevabında matematik", () => {
  it("LaTeX'i tanır, para tutarını tanımaz", () => {
    expect(hasMath("Tümleyen $\\bar{A}$ olur")).toBe(true);
    expect(hasMath("$$S(a,b) = a + b - ab$$")).toBe(true);
    expect(hasMath("Fiyat $5 ve $10 arası")).toBe(false);
  });
  it("kopyalarken okunur düz metne çevirir", () => {
    expect(mathToPlain("formül $\\mu_{\\bar{A}}(x) = 1 - \\mu_A(x)$ olur")).toBe("formül μ_Ā(x) = 1 - μ_A(x) olur");
    expect(mathToPlain("$\\frac{a}{b} \\le \\sqrt{x}$")).toBe("(a)/(b) ≤ √(x)");
  });
});

describe("düz metinde noktalı virgül", () => {
  it("LaTeX boşluk komutu dışındaki ; korunur", () => {
    expect(mathToPlain(String.raw`$a;b\;c$`)).toBe("a;b c");
  });
});
