import { describe, expect, it } from "vitest";
import { cardFromHighlight, deck, dueCards, freshSchedule, nextLabel, parseSuggestions, schedule } from "../src/review/srs";
import type { Highlight } from "../src/types";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 30);

describe("aralıklı tekrar", () => {
  it("yeni kart: 10 dk / 1 gün / 1 gün; ikinci başarıda 4 gün, sonra kolaylıkla uzar", () => {
    const c = freshSchedule(now);
    expect(nextLabel(c, 1, now)).toBe("10 dk sonra");
    expect(nextLabel(c, 2, now)).toBe("1 gün sonra");
    const a = schedule(c, 3, now);
    expect(a.interval).toBe(1);
    const b = schedule(a, 3, now);
    expect(b.interval).toBe(4);
    const d = schedule(b, 3, now);
    expect(d.interval).toBeGreaterThanOrEqual(10);
    expect(d.due).toBe(now + d.interval * DAY);
  });
  it("bilemeyince sıfırlanır, kolaylık düşer ama 1,3'ün altına inmez", () => {
    let c = { ...freshSchedule(now), reps: 5, interval: 30, ease: 1.35 };
    c = schedule(c, 1, now);
    expect(c).toMatchObject({ reps: 0, interval: 0, ease: 1.3, lapses: 1 });
  });
});

const hl = (id: string, color: 1 | 2 | 3 | 4, text: string, group?: string): Highlight =>
  ({ id, fileHash: "f", page: 1, color, rects: [[0, 0, 1, 1]], text, note: "", createdAt: 0, updatedAt: 0, ...(group ? { group } : {}) });

describe("deste", () => {
  it("seçilen renklerin vurgularından kart oluşturur, var olanı yeniden kullanır, grupta tek kart", () => {
    const hls = [hl("a", 4, "Normal dağılım iki parametreyle belirlenir"), hl("b", 1, "önemli"), hl("c", 4, "birinci parça", "g"), hl("d", 4, "ikinci parça", "g")];
    const first = deck([], hls, new Set([4]), false, now);
    expect(first.cards).toHaveLength(2);
    expect(first.created[1].back).toBe("birinci parça ikinci parça");
    const again = deck(first.created, hls, new Set([4]), false, now);
    expect(again.created).toHaveLength(0);
    expect(cardFromHighlight(hls[0], now).front).toBe("„Normal dağılım …\" — devamını hatırla.");
  });
  it("vadesi gelenler, en eski önce; öneriler hariç", () => {
    const a = { ...cardFromHighlight(hl("a", 4, "x"), now), due: now - 5 };
    const b = { ...cardFromHighlight(hl("b", 4, "y"), now), due: now - 10 };
    const c = { ...cardFromHighlight(hl("c", 4, "z"), now), due: now + DAY };
    const s = { ...a, id: "s", status: "suggested" as const };
    expect(dueCards([a, b, c, s], now).map((x) => x.id)).toEqual(["hl-b", "hl-a"]);
  });
});

describe("AI kart önerisi biçimi", () => {
  it("S:/C: bloklarını ve kaynak sayfasını okur", () => {
    const out = parseSuggestions('Kartlar:\n\nS: Normal dağılımı belirleyen iki parametre nedir?\nC: Ortalama ve standart sapma [s. 112: "iki parametreyle"].\n\n**S:** Z dönüşümü ne işe yarar?\n**C:** Standart normale indirger.');
    expect(out).toEqual([
      { front: "Normal dağılımı belirleyen iki parametre nedir?", back: 'Ortalama ve standart sapma [s. 112: "iki parametreyle"].', page: 111 },
      { front: "Z dönüşümü ne işe yarar?", back: "Standart normale indirger.", page: null },
    ]);
  });
});
