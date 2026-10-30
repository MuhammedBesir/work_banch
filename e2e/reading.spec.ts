import { expect, test } from "@playwright/test";
import { collectErrors, openExport, openSample, selectSpan } from "./helpers";

test.describe("Oku modu", () => {
  test("dosya açılır, seçim vurguya ve nota dönüşür", async ({ page }) => {
    const errors = collectErrors(page);
    await openSample(page);
    await selectSpan(page, 2);
    await expect(page.locator(".cm-floatwrap:not([hidden])")).toBeVisible();
    await page.keyboard.press("3");
    await expect(page.locator(".cm-hlrect").first()).toBeVisible();
    await expect(page.locator(".cm-panel .cm-item")).toHaveCount(1);
    await page.keyboard.press("n");
    await page.locator("textarea.cm-notebox").fill("Sınavda grafik sorulabilir.");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".cm-item__note").first()).toHaveText(/grafik/);
    expect(errors).toEqual([]);
  });

  test("vurgular yeniden açınca yerinde", async ({ page }) => {
    await openSample(page);
    await selectSpan(page, 4);
    await page.keyboard.press("1");
    await expect(page.locator(".cm-hlrect").first()).toBeVisible();
    await page.reload();
    await expect(page.locator(".cm-drop")).toBeVisible();
    await openSample(page);
    await expect(page.locator(".cm-panel .cm-item")).toHaveCount(1);
  });

  test("arama bütün eşleşmeleri sayar ve sayfada gösterir", async ({ page }) => {
    await openSample(page);
    await page.locator(".cm-stage").focus();
    await page.keyboard.press("Control+f");
    await page.locator(".cm-search input").fill("sigma grows");
    await expect(page.locator(".cm-search__count")).toHaveText(/\/\s*\d+/);
    await expect(page.locator(".cm-searchhit").first()).toBeVisible();
  });

  test("Markdown dışa aktarma iner", async ({ page }) => {
    await openSample(page);
    await selectSpan(page, 2);
    await page.keyboard.press("2");
    await openExport(page, /Markdown/);
    const download = page.waitForEvent("download");
    await page.locator(".cm-dialog").getByRole("button", { name: /^İndir .md/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.md$/);
  });
});
