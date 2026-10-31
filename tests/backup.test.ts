import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as db from "../src/db";
import { createBackup, parseBackup, restoreBackup } from "../src/backup";

describe("yedek", () => {
  it("yedek alır, siler ve geri yükler", async () => {
    await db.putFile({ hash: "h1", name: "a.pdf", size: 10, pageCount: 3, lastPage: 2, lastOpened: 1, bookmarks: [1] });
    await db.putHighlight({ id: "x", fileHash: "h1", page: 0, color: 2, rects: [[0, 0, 1, 1]], text: "t", note: "n", createdAt: 1, updatedAt: 1 });
    await db.putMark({ id: "m", fileHash: "h1", page: 0, kind: "text", color: "blue", box: [0.1, 0.1, 0.3, 0.05], text: "Z = standartlaştırma", createdAt: 1, updatedAt: 1 });
    await db.putMeta("quiz:h1", [{ id: "q", title: "Quiz", createdAt: 1, summary: "", questions: [] }]);
    await db.putMeta("backupDir", "yedeğe girmemeli");
    const s = await db.loadSettings();
    await db.saveSettings({ ...s, ai: { ...s.ai, mode: "anthropic", keys: { gemini: "", anthropic: "sk-ant-gizli", openai: "sk-gizli2" } } });
    const b = parseBackup(JSON.stringify(await createBackup()));
    expect(JSON.stringify(b)).not.toContain("sk-ant-gizli"); // anahtarlar yedeğe girmez
    expect(JSON.stringify(b)).not.toContain("sk-gizli2");
    expect(b.highlights).toHaveLength(1);

    await db.clearAll();
    expect(await db.highlightsFor("h1")).toEqual([]);

    const r = await restoreBackup(b);
    expect(r).toEqual({ highlights: 1, files: 1, marks: 1 });
    expect((await db.marksFor("h1"))[0]).toMatchObject({ kind: "text", text: "Z = standartlaştırma" });
    expect((await db.highlightsFor("h1"))[0].note).toBe("n");
    expect((await db.getFile("h1"))?.bookmarks).toEqual([1]);
    expect((await db.loadSettings()).ai.mode).toBe("anthropic");
    // Quizler yedekle döner; yedek dışı meta (klasör tutamacı gibi) yedeğe girmez.
    expect(await db.getMeta("quiz:h1")).toMatchObject([{ title: "Quiz" }]);
    expect(b.meta?.backupDir).toBeUndefined();
  });

  it("yabancı dosyayı açık bir mesajla reddeder", () => {
    expect(() => parseBackup("not json")).toThrow(/okunamadı/);
    expect(() => parseBackup('{"foo":1}')).toThrow(/Çalışma Masası yedeği değil/);
  });
});
