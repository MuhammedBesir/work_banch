import { dateLong } from "./format";
import { readingOrder } from "./geometry";
import type { Color, Highlight } from "./types";
import { COLORS } from "./types";

export interface ExportOptions {
  title: string;
  names: Record<Color, string>;
  colors: Set<Color>;
  groupBy: "page" | "color";
  onlyWithNotes: boolean;
  now?: number;
}

export function selectForExport(list: Highlight[], o: Pick<ExportOptions, "colors" | "onlyWithNotes">): Highlight[] {
  return list
    .filter((h) => o.colors.has(h.color) && (!o.onlyWithNotes || h.note.trim() !== ""))
    .sort(readingOrder);
}

/** Vurgular ve notlar, sayfa numaralarıyla. Obsidian, Notion veya herhangi bir editörde açılır. */
export function toMarkdown(list: Highlight[], o: ExportOptions): string {
  const items = selectForExport(list, o);
  const notes = items.filter((h) => h.note.trim()).length;
  const out = [`# ${o.title}`, `_${items.length} vurgu · ${notes} not · ${dateLong(o.now ?? Date.now())}_`, ""];

  const item = (h: Highlight, withPage: boolean) => {
    const label = withPage ? `**[s. ${h.page + 1}]**` : `**[${o.names[h.color]}]**`;
    const lines = [`- ${label} ${oneLine(h.text)}`];
    if (h.note.trim()) {
      const noteLines = h.note.trim().split(/\r?\n/);
      lines.push(`  > Not: ${noteLines[0]}`, ...noteLines.slice(1).map((l) => `  > ${l}`));
    }
    return lines.join("\n");
  };

  if (o.groupBy === "page") {
    let page = -1;
    for (const h of items) {
      if (h.page !== page) {
        page = h.page;
        out.push(`## Sayfa ${page + 1}`, "");
      }
      out.push(item(h, false));
      if (items[items.indexOf(h) + 1]?.page !== page) out.push("");
    }
  } else {
    for (const c of COLORS) {
      const group = items.filter((h) => h.color === c);
      if (!group.length) continue;
      out.push(`## ${o.names[c]}`, "", ...group.map((h) => item(h, true)), "");
    }
  }
  return out.join("\n").trimEnd() + "\n";
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** `<pdf adı>-notlar.md` */
export function exportFileName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, "")}-notlar.md`;
}
