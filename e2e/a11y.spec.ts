import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openExport, openSample, selectSpan } from "./helpers";

// WCAG 2.1 AA otomatik denetimi. Ekran okuyucuyla elle gezinti bunun yerini tutmaz.
const audit = (page: Page) =>
  new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // PDF metin katmanı saydamdır (seçim için); kontrastı canvas'taki görüntü belirler.
    .exclude(".textLayer")
    .analyze();

const summary = (r: Awaited<ReturnType<typeof audit>>) =>
  r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);

test.describe("Erişilebilirlik", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "axe denetimi bir tarayıcıda yeterli");

  test("giriş ekranı", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".cm-drop")).toBeVisible();
    expect(summary(await audit(page))).toEqual([]);
  });

  test("okuyucu, vurgu ve panel", async ({ page }) => {
    await openSample(page);
    await selectSpan(page, 2);
    await page.keyboard.press("1");
    await expect(page.locator(".cm-hlrect").first()).toBeVisible();
    expect(summary(await audit(page))).toEqual([]);
  });

  test("koyu tema", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openSample(page);
    expect(summary(await audit(page))).toEqual([]);
  });

  test("ayarlar ve dışa aktarma diyalogları", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Ayarlar" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(summary(await audit(page))).toEqual([]);
    await page.keyboard.press("Escape");
    await openSample(page);
    await selectSpan(page, 2);
    await page.keyboard.press("1");
    await openExport(page, /Vurgulu PDF/);
    expect(summary(await audit(page))).toEqual([]);
  });

  test("Yaz modu ve Tekrar modu", async ({ page }) => {
    await openSample(page);
    await page.getByRole("button", { name: "Yaz", exact: true }).first().click();
    expect(summary(await audit(page))).toEqual([]);
    await page.getByRole("button", { name: "Oku", exact: true }).first().click();
    await page.keyboard.press("Alt+t");
    await expect(page.locator(".cm-review")).toBeVisible();
    expect(summary(await audit(page))).toEqual([]);
  });

  test("telefon genişliği", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSample(page);
    expect(summary(await audit(page))).toEqual([]);
  });
});
