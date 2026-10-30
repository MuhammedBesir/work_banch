import { describe, expect, it } from "vitest";
import { exportFileName, toMarkdown } from "../src/markdown";
import type { Color, Highlight } from "../src/types";
import { DEFAULT_NAMES } from "../src/types";

const hl = (id: string, page: number, color: Color, y: number, text: string, note = ""): Highlight => ({
  id, fileHash: "x", page, color, rects: [[0.1, y, 0.5, 0.02]], text, note, createdAt: 0, updatedAt: 0,
});

const list = [
  hl("a", 112, 3, 0.4, "σ büyüdükçe eğri yayvanlaşır", "Geçen yılın vizesinde vardı."),
  hl("b", 111, 1, 0.2, "normal dağılımdır;\n iki parametreyle"),
  hl("c", 111, 4, 0.5, "Tanım 4.7.", "Formülü ezberleme,\nμ ve σ'yı bil."),
];

const base = { title: "İST 201", names: DEFAULT_NAMES, colors: new Set<Color>([1, 2, 3, 4]), groupBy: "page" as const, onlyWithNotes: false, now: Date.UTC(2026, 9, 29, 12) };

describe("toMarkdown", () => {
  it("sayfaya göre gruplar, okuma sırasını ve notları korur", () => {
    expect(toMarkdown(list, base)).toBe(
      [
        "# İST 201",
        "_3 vurgu · 2 not · 29 Ekim 2026_",
        "",
        "## Sayfa 112",
        "",
        "- **[Önemli]** normal dağılımdır; iki parametreyle",
        "- **[Tanım]** Tanım 4.7.",
        "  > Not: Formülü ezberleme,",
        "  > μ ve σ'yı bil.",
        "",
        "## Sayfa 113",
        "",
        "- **[Sınavda çıkar]** σ büyüdükçe eğri yayvanlaşır",
        "  > Not: Geçen yılın vizesinde vardı.",
        "",
      ].join("\n"),
    );
  });

  it("renge göre gruplar ve sayfa numarası yazar", () => {
    const md = toMarkdown(list, { ...base, groupBy: "color" });
    expect(md).toContain("## Önemli\n\n- **[s. 112]** normal dağılımdır;");
    expect(md.indexOf("## Sınavda çıkar")).toBeLessThan(md.indexOf("## Tanım"));
  });

  it("renk ve yalnızca-notlu filtreleri uygular", () => {
    const md = toMarkdown(list, { ...base, colors: new Set<Color>([1, 3]), onlyWithNotes: true });
    expect(md).toContain("_1 vurgu · 1 not");
    expect(md).not.toContain("Tanım 4.7");
  });

  it("metin kutuları ve notlar sayfada yerlerine göre girer", () => {
    const marks = [
      { id: "t", fileHash: "x", page: 111, kind: "text" as const, color: "blue" as const, box: [0.1, 0.3, 0.3, 0.05] as [number, number, number, number], text: "Z = standartlaştırma", createdAt: 0, updatedAt: 0 },
      { id: "s", fileHash: "x", page: 111, kind: "sticky" as const, ai: true, box: [0.7, 0.9, 0.2, 0.1] as [number, number, number, number], text: "Kısa açıklama\nikinci satır", createdAt: 0, updatedAt: 0 },
      { id: "i", fileHash: "x", page: 2, kind: "ink" as const, color: "red" as const, width: 2, points: [[0, 0]] as [number, number][], createdAt: 0, updatedAt: 0 },
    ];
    const md = toMarkdown(list, { ...base, marks });
    expect(md).toContain("_3 vurgu · 2 not · 2 yazı");
    expect(md).toContain("- **[Önemli]** normal dağılımdır; iki parametreyle\n- **[Metin kutusu]** Z = standartlaştırma\n- **[Tanım]** Tanım 4.7.");
    expect(md).toContain("- **[AI notu]** Kısa açıklama\n  ikinci satır");
    expect(md).not.toContain("Sayfa 3");
    expect(toMarkdown(list, { ...base, groupBy: "color", marks })).toContain("## Yazılar\n\n- **[s. 112 · Metin kutusu]**");
  });

  it("dosya adı", () => {
    expect(exportFileName("IST201_Bolum4.PDF")).toBe("IST201_Bolum4-notlar.md");
  });
});
