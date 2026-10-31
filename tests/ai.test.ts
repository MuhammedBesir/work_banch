import { describe, expect, it } from "vitest";
import { citedPages, contextChars, plainText, segment, userMessage } from "../src/ai/prompt";

describe("segment", () => {
  it("kaynağı önündeki cümleye bağlar, kaynaksız cümleyi ayırır", () => {
    const out = segment('Önce ortalamayı çıkarırsın, merkez 0 olur [s. 112: "standart normale indirgenebilir"]. Sonra σ\'ya bölersin. Z = 2 nadirdir [s. 112: "%95\'i μ ± 2σ"].');
    expect(out.map((s) => s.cites.length)).toEqual([1, 0, 1]);
    expect(out[0].text).toBe("Önce ortalamayı çıkarırsın, merkez 0 olur.");
    expect(out[0].cites[0]).toEqual({ page: 111, quote: "standart normale indirgenebilir" });
    expect(out[1].text).toBe("Sonra σ'ya bölersin.");
  });

  it("alıntısız etiketi de tanır", () => {
    expect(segment("Tanım burada [s. 3].")[0].cites).toEqual([{ page: 2, quote: "" }]);
  });
});

describe("yardımcılar", () => {
  it("not metninde etiketler sadeleşir", () => {
    expect(plainText('Z dönüşümü [s. 112: "x y z"]. Bitti.')).toBe("Z dönüşümü (s. 112). Bitti.");
  });
  it("kaynak sayfalarını tekil döndürür", () => {
    expect(citedPages('a [s. 3: "x"] b [s. 3] c [s. 5: "y"]')).toEqual([2, 4]);
  });
  it("mesaj sayfa etiketleriyle gider; karakter sayısı kapsam metninindir", () => {
    const ctx = { label: "sayfa 2 metni", pages: [{ page: 1, text: " merhaba " }] };
    expect(userMessage(ctx, "Özetle")).toBe('<belge kapsam="sayfa 2 metni">\n<sayfa no="2">\nmerhaba\n</sayfa>\n</belge>\n\nÖzetle');
    expect(contextChars(ctx)).toBe(7);
  });
});

import { parseStamped } from "../src/ai/gemini";

describe("Gemini yazıya dökme", () => {
  it("zaman damgalı satırları ayrıştırır", () => {
    expect(parseStamped("[00:05] Merhaba\n[01:02:03] Uzun ders\ndevamı")).toEqual([
      { t: 5000, text: "Merhaba" },
      { t: 3723000, text: "Uzun ders devamı" },
    ]);
  });
});
