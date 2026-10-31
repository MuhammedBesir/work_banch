import type { Color, Highlight, Mark } from "../types";
import { readingOrder } from "../geometry";
import { richPlain } from "../write/rich";
import { stickyLabel } from "../write/layer";

// Word, PowerPoint ve resim dışa aktarma. Kütüphaneler ayrı parça olarak yalnızca kullanılınca yüklenir.

const HL_FILL: Record<Color, string> = { 1: "F5D76E", 2: "F2A48F", 3: "A9CBEC", 4: "BDDBA6" };

export interface NotesInput {
  title: string;
  names: Record<Color, string>;
  highlights: Highlight[];
  marks: Mark[];
  /** Tanınmış el yazısı, sayfa → metin. */
  handwriting: Map<number, string>;
}

const dataBytes = (src: string) => Uint8Array.from(atob(src.split(",")[1]), (c) => c.charCodeAt(0));

/** Notlar Word belgesi: sayfa sayfa vurgular (renkli), notlar, metin kutuları, el yazısı ve resimler. */
export async function notesDocx(o: NotesInput): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ShadingType, ImageRun } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(o.title)] }),
    new Paragraph({ children: [new TextRun({ text: `Çalışma Masası · ${new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}`, color: "6B655C", size: 18 })] }),
  ];
  const pages = new Set<number>([...o.highlights.map((x) => x.page), ...o.marks.filter((m) => m.kind !== "ink" && m.kind !== "shape").map((m) => m.page), ...o.handwriting.keys()]);
  for (const page of [...pages].sort((a, b) => a - b)) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(`Sayfa ${page + 1}`)] }));
    const seen = new Set<string>();
    for (const x of o.highlights.filter((h) => h.page === page).sort(readingOrder)) {
      if (x.group && seen.has(x.group)) continue;
      if (x.group) seen.add(x.group);
      const text = x.group ? o.highlights.filter((h) => h.group === x.group).sort((a, b) => a.page - b.page).map((h) => h.text).join(" ") : x.text;
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${o.names[x.color]}: `, bold: true, size: 20, color: "57524A" }),
          new TextRun({ text, shading: { type: ShadingType.CLEAR, fill: HL_FILL[x.color], color: "auto" } }),
        ],
      }));
      if (x.note.trim()) children.push(new Paragraph({ indent: { left: 360 }, spacing: { after: 120 }, children: [new TextRun({ text: `Notum: ${x.note.trim()}`, italics: true })] }));
    }
    for (const m of o.marks.filter((x) => x.page === page)) {
      if ((m.kind === "text" || m.kind === "sticky") && m.text.trim()) {
        const label = m.kind === "text" ? "Metin kutusu" : stickyLabel(m);
        const lines = richPlain(m.text).split("\n");
        children.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: `${label}: `, bold: true, size: 20, color: "57524A" }), new TextRun(lines[0])] }));
        for (const l of lines.slice(1)) children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun(l)] }));
      } else if (m.kind === "image") {
        const w = 420;
        children.push(new Paragraph({
          spacing: { before: 80, after: 80 },
          children: [new ImageRun({ type: m.src.includes("image/png") ? "png" : "jpg", data: dataBytes(m.src), transformation: { width: w, height: Math.round((w * m.box[3]) / m.box[2] * 1.414) } })],
        }));
      }
    }
    const hw = o.handwriting.get(page);
    if (hw?.trim()) children.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: "El yazısı: ", bold: true, size: 20, color: "57524A" }), new TextRun(hw.replace(/\n/g, " / "))] }));
  }
  const doc = new Document({ creator: "Çalışma Masası", title: o.title, sections: [{ children }] });
  return Packer.toBlob(doc);
}

/** PDF'in sayfalarını (işaretlerle birlikte, düzleştirilmiş) resim olarak çiz. */
export async function renderPages(pdf: Uint8Array, maxWidth: number, onProgress?: (done: number, total: number) => void, only?: number[]): Promise<{ png: string; w: number; h: number }[]> {
  const { pdfjs } = await import("../pdf/load");
  const doc = await pdfjs.getDocument({ data: pdf }).promise;
  const out: { png: string; w: number; h: number }[] = [];
  const list = only ?? [...Array(doc.numPages).keys()];
  try {
    for (const i of list) {
      const page = await doc.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, maxWidth / vp1.width) });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ png: c.toDataURL("image/png"), w: vp1.width, h: vp1.height });
      onProgress?.(out.length, list.length);
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

/** Her sayfa bir slayt (sayfa oranında); konuşmacı notlarına o sayfanın notları. */
export async function pagesPptx(title: string, images: { png: string; w: number; h: number }[], notes: string[]): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  const first = images[0];
  const W = 10;
  const H = +(W * (first.h / first.w)).toFixed(3);
  pptx.defineLayout({ name: "PDF", width: W, height: H });
  pptx.layout = "PDF";
  pptx.title = title;
  pptx.company = "Çalışma Masası";
  images.forEach((img, i) => {
    const slide = pptx.addSlide();
    // Farklı oranlı sayfa ortalanır.
    const k = Math.min(W / img.w, H / img.h);
    const w = img.w * k;
    const h = img.h * k;
    slide.addImage({ data: img.png, x: (W - w) / 2, y: (H - h) / 2, w, h });
    if (notes[i]) slide.addNotes(notes[i]);
  });
  return (await pptx.write({ outputType: "blob" })) as Blob;
}

/** Bütün sayfalar PNG olarak tek ZIP'te. */
export async function pagesZip(base: string, images: { png: string }[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const pad = String(images.length).length;
  images.forEach((img, i) => zip.file(`${base}-s${String(i + 1).padStart(pad, "0")}.png`, img.png.split(",")[1], { base64: true }));
  return zip.generateAsync({ type: "blob" });
}

/** Konuşmacı notu: o sayfanın vurgu notları ve yazılı notları. */
export function pageNotes(pageCount: number, highlights: Highlight[], marks: Mark[], names: Record<Color, string>): string[] {
  return Array.from({ length: pageCount }, (_, p) => [
    ...highlights.filter((x) => x.page === p).map((x) => `${names[x.color]}: ${x.text}${x.note.trim() ? ` — ${x.note.trim()}` : ""}`),
    ...marks.filter((m) => m.page === p && (m.kind === "text" || m.kind === "sticky") && m.text.trim()).map((m) => richPlain((m as { text: string }).text)),
  ].join("\n"));
}
