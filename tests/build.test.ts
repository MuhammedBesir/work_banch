import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFHexString } from "pdf-lib";
import { buildPdf } from "../src/editor/build";

async function sample(pages = 3): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([600, 800]);
  return d.save();
}

describe("buildPdf", () => {
  it("kırpma ve not alanı sayfa kutusunu değiştirir", async () => {
    const bytes = await sample();
    const out = await buildPdf(
      [
        { key: "a", src: "main", index: 0, rotation: 0, crop: [0.1, 0.1, 0.5, 0.5] },
        { key: "b", src: "main", index: 1, rotation: 0, margin: 0.5 },
      ],
      new Map([["main", { id: "main", bytes }]]),
    );
    const d = await PDFDocument.load(out);
    const [a, b] = d.getPages();
    expect(a.getCropBox()).toMatchObject({ x: 60, y: 320, width: 300, height: 400 });
    expect(b.getMediaBox()).toMatchObject({ x: 0, y: 0, width: 900, height: 800 });
  });

  it("içindekiler ağacını yeni sayfa sırasıyla taşır", async () => {
    const bytes = await sample();
    const out = await buildPdf(
      [
        { key: "c", src: "main", index: 2, rotation: 0 },
        { key: "a", src: "main", index: 0, rotation: 0 },
      ],
      new Map([["main", { id: "main", bytes }]]),
      [{ title: "Giriş", page: 0, children: [] }, { title: "Silinen", page: 1, children: [] }, { title: "Sonuç", page: 2, children: [] }],
    );
    const d = await PDFDocument.load(out);
    const root = d.catalog.lookup(PDFName.of("Outlines"), PDFDict);
    const titles: string[] = [];
    let node = root.lookupMaybe(PDFName.of("First"), PDFDict);
    while (node) {
      titles.push((node.lookup(PDFName.of("Title")) as PDFHexString).decodeText());
      node = node.lookupMaybe(PDFName.of("Next"), PDFDict);
    }
    expect(titles).toEqual(["Giriş", "Sonuç"]);
  });
});
