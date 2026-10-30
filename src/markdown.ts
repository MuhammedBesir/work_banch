import { dateLong } from "./format";
import { readingOrder } from "./geometry";
import type { Color, Highlight, Mark } from "./types";
import { COLORS } from "./types";

export interface ExportOptions {
  title: string;
  names: Record<Color, string>;
  colors: Set<Color>;
  groupBy: "page" | "color";
  onlyWithNotes: boolean;
  /** Yaz modu metin kutuları ve yapışkan notlar: sayfaya göre düzende ilgili sayfada. */
  marks?: Mark[];
  now?: number;
}

export function selectForExport(list: Highlight[], o: Pick<ExportOptions, "colors" | "onlyWithNotes">): Highlight[] {
  return list
    .filter((h) => o.colors.has(h.color) && (!o.onlyWithNotes || h.note.trim() !== ""))
    .sort(readingOrder);
}

type Writing = Extract<Mark, { kind: "text" | "sticky" }>;

/** Vurgular, notlar ve (istenirse) metin kutuları / yapışkan notlar, sayfa numaralarıyla. Obsidian, Notion veya herhangi bir editörde açılır. */
export function toMarkdown(list: Highlight[], o: ExportOptions): string {
  const items = selectForExport(list, o);
  const writings = (o.marks ?? [])
    .filter((m): m is Writing => (m.kind === "text" || m.kind === "sticky") && m.text.trim() !== "")
    .sort((a, b) => a.page - b.page || a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  const notes = items.filter((h) => h.note.trim()).length;
  const counts = [`${items.length} vurgu`, `${notes} not`, ...(writings.length ? [`${writings.length} yazı`] : [])];
  const out = [`# ${o.title}`, `_${counts.join(" · ")} · ${dateLong(o.now ?? Date.now())}_`, ""];

  const quote = (text: string) => text.trim().split(/\r?\n/);
  const item = (h: Highlight, withPage: boolean) => {
    const label = withPage ? `**[s. ${h.page + 1}]**` : `**[${o.names[h.color]}]**`;
    const lines = [`- ${label} ${oneLine(h.text)}`];
    if (h.note.trim()) {
      const noteLines = quote(h.note);
      lines.push(`  > Not: ${noteLines[0]}`, ...noteLines.slice(1).map((l) => `  > ${l}`));
    }
    return lines.join("\n");
  };
  const writing = (m: Writing, withPage: boolean) => {
    const kind = m.kind === "text" ? "Metin kutusu" : m.ai ? "AI notu" : "Yapışkan not";
    const [first, ...rest] = quote(m.text);
    return [`- **[${withPage ? `s. ${m.page + 1} · ` : ""}${kind}]** ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
  };

  if (o.groupBy === "page") {
    const pages = [...new Set([...items.map((h) => h.page), ...writings.map((m) => m.page)])].sort((a, b) => a - b);
    for (const page of pages) {
      const rows = [
        ...items.filter((h) => h.page === page).map((h) => ({ y: h.rects[0]?.[1] ?? 0, x: h.rects[0]?.[0] ?? 0, text: item(h, false) })),
        ...writings.filter((m) => m.page === page).map((m) => ({ y: m.box[1], x: m.box[0], text: writing(m, false) })),
      ].sort((a, b) => a.y - b.y || a.x - b.x);
      out.push(`## Sayfa ${page + 1}`, "", ...rows.map((r) => r.text), "");
    }
  } else {
    for (const c of COLORS) {
      const group = items.filter((h) => h.color === c);
      if (!group.length) continue;
      out.push(`## ${o.names[c]}`, "", ...group.map((h) => item(h, true)), "");
    }
    if (writings.length) out.push("## Yazılar", "", ...writings.map((m) => writing(m, true)), "");
  }
  return out.join("\n").trimEnd() + "\n";
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** `<pdf adı>-notlar.md` */
export function exportFileName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, "")}-notlar.md`;
}
