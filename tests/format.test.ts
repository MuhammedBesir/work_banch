import { describe, expect, it } from "vitest";
import { bytes, fold, num, percent, relative } from "../src/format";

describe("format", () => {
  it("Türkçe sayı biçimi", () => {
    expect(num(1840)).toBe("1.840");
    expect(bytes(18.4 * 1024 * 1024)).toBe("18,4 MB");
    expect(percent(0.68)).toBe("%68");
  });
  it("göreli tarih", () => {
    const now = new Date(2026, 9, 29, 14, 20).getTime();
    expect(relative(now - 60_000, now)).toMatch(/^Bugün, 14:19$/);
    expect(relative(now - 86_400_000, now)).toBe("Dün");
    expect(relative(now - 3 * 86_400_000, now)).toBe("3 gün önce");
    expect(relative(now - 14 * 86_400_000, now)).toBe("2 hafta önce");
  });
  it("Türkçe büyük/küçük harf katlama", () => {
    expect(fold("İSTATİSTİK ILIK")).toBe("istatistik ılık");
  });
});
