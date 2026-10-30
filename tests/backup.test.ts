import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as db from "../src/db";
import { createBackup, parseBackup, restoreBackup } from "../src/backup";

describe("yedek", () => {
  it("yedek alır, siler ve geri yükler", async () => {
    await db.putFile({ hash: "h1", name: "a.pdf", size: 10, pageCount: 3, lastPage: 2, lastOpened: 1, bookmarks: [1] });
    await db.putHighlight({ id: "x", fileHash: "h1", page: 0, color: 2, rects: [[0, 0, 1, 1]], text: "t", note: "n", createdAt: 1, updatedAt: 1 });
    const b = parseBackup(JSON.stringify(await createBackup()));
    expect(b.highlights).toHaveLength(1);

    await db.clearAll();
    expect(await db.highlightsFor("h1")).toEqual([]);

    const r = await restoreBackup(b);
    expect(r).toEqual({ highlights: 1, files: 1 });
    expect((await db.highlightsFor("h1"))[0].note).toBe("n");
    expect((await db.getFile("h1"))?.bookmarks).toEqual([1]);
  });

  it("yabancı dosyayı açık bir mesajla reddeder", () => {
    expect(() => parseBackup("not json")).toThrow(/okunamadı/);
    expect(() => parseBackup('{"foo":1}')).toThrow(/Çalışma Masası yedeği değil/);
  });
});
