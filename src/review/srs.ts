import type { Card, Color, Highlight } from "../types";

// Aralıklı tekrar: SM-2'nin üç dereceli sade hali. Plan bu tarayıcıda saklanır ve yedeğe dahildir.

export type Grade = 1 | 2 | 3;

const MIN = 60_000;
const DAY = 86_400_000;
const MIN_EASE = 1.3;

export interface Schedule {
  due: number;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
}

/** 1 Bilemedim: 10 dk sonra yeniden · 2 Zorlandım: aralık biraz uzar · 3 Bildim: aralık kolaylık katsayısıyla uzar. */
export function schedule(c: Schedule, grade: Grade, now = Date.now()): Schedule {
  if (grade === 1) {
    return { due: now + 10 * MIN, interval: 0, ease: Math.max(MIN_EASE, c.ease - 0.2), reps: 0, lapses: c.lapses + 1 };
  }
  if (grade === 2) {
    const interval = c.reps === 0 ? 1 : Math.max(1, Math.round(c.interval * 1.2));
    return { due: now + interval * DAY, interval, ease: Math.max(MIN_EASE, c.ease - 0.15), reps: c.reps + 1, lapses: c.lapses };
  }
  const interval = c.reps === 0 ? 1 : c.reps === 1 ? 4 : Math.max(c.interval + 1, Math.round(c.interval * c.ease));
  return { due: now + interval * DAY, interval, ease: Math.min(3, c.ease + 0.05), reps: c.reps + 1, lapses: c.lapses };
}

/** Derece düğmesinin altındaki "10 dk sonra", "1 gün sonra", "4 gün sonra". */
export function nextLabel(c: Schedule, grade: Grade, now = Date.now()): string {
  const ms = schedule(c, grade, now).due - now;
  if (ms < 60 * MIN) return `${Math.round(ms / MIN)} dk sonra`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days} gün sonra`;
  return `${Math.round(days / 30)} ay sonra`;
}

export const freshSchedule = (now = Date.now()): Schedule => ({ due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 });

/** Vurgudan kart: ön yüz ilk birkaç kelime ("devamını hatırla"), arka yüz vurgunun tamamı ve not. */
export function cardFromHighlight(hl: Highlight, now = Date.now()): Card {
  const words = hl.text.replace(/\s+/g, " ").trim().split(" ");
  const lead = words.slice(0, Math.min(6, Math.max(2, Math.ceil(words.length / 3)))).join(" ");
  return {
    id: `hl-${hl.id}`,
    fileHash: hl.fileHash,
    page: hl.page,
    source: "highlight",
    highlightId: hl.id,
    color: hl.color,
    front: `„${lead} …" — devamını hatırla.`,
    back: hl.text.replace(/\s+/g, " ").trim(),
    note: hl.note.trim() || undefined,
    status: "active",
    ...freshSchedule(now),
    createdAt: now,
    updatedAt: now,
  };
}

/** Destedeki kartlar: seçilen renklerin vurgu kartları (yoksa oluşturulur) ve onaylanmış AI kartları. */
export function deck(cards: Card[], highlights: Highlight[], colors: Set<Color>, includeAi: boolean, now = Date.now()): { cards: Card[]; created: Card[] } {
  const byHl = new Map(cards.filter((c) => c.highlightId).map((c) => [c.highlightId!, c]));
  const created: Card[] = [];
  const out: Card[] = [];
  // Sayfalar arası vurguda tek kart: grubun ilk parçası.
  const seen = new Set<string>();
  for (const hl of highlights) {
    if (!colors.has(hl.color)) continue;
    if (hl.group) {
      if (seen.has(hl.group)) continue;
      seen.add(hl.group);
    }
    let c = byHl.get(hl.id);
    if (!c) {
      const parts = hl.group ? highlights.filter((x) => x.group === hl.group) : [hl];
      c = cardFromHighlight({ ...hl, text: parts.map((p) => p.text).join(" ") }, now);
      created.push(c);
    }
    out.push(c);
  }
  if (includeAi) out.push(...cards.filter((c) => c.source === "ai" && c.status === "active"));
  return { cards: out, created };
}

/** Bugün çalışılacaklar: vadesi gelmiş kartlar, en eski vade önce. */
export const dueCards = (cards: Card[], now = Date.now()): Card[] =>
  cards.filter((c) => c.status === "active" && c.due <= now).sort((a, b) => a.due - b.due);

/**
 * AI'nın kart önerisi biçimi:
 *   S: soru
 *   C: cevap [s. 12: "alıntı"]
 * Bloklar boş satırla ayrılır. Biçime uymayan kısım yok sayılır.
 */
export function parseSuggestions(text: string): { front: string; back: string; page: number | null }[] {
  const out: { front: string; back: string; page: number | null }[] = [];
  const re = /(?:^|\n)\s*S\s*[:：]\s*([\s\S]+?)\n\s*C\s*[:：]\s*([\s\S]+?)(?=\n\s*S\s*[:：]|\s*$)/g;
  for (const m of text.replace(/\*\*/g, "").matchAll(re)) {
    const front = m[1].trim();
    const back = m[2].trim();
    const page = /\[s\.\s*(\d+)/.exec(back);
    if (front && back) out.push({ front, back, page: page ? Number(page[1]) - 1 : null });
  }
  return out;
}
