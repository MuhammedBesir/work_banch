import { expect, test } from "@playwright/test";
import { dropPdf } from "./helpers";

// Tanıma ağır (WASM + ~5 MB veri); masaüstü Chromium'da yeterli.
test("Taranmış sayfa: OCR sonrası arama ve vurgu", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium" || info.project.name !== "chromium", "OCR yalnızca masaüstü Chromium'da denenir");
  test.setTimeout(180_000);
  await page.goto("/");
  await dropPdf(page, "tarama.pdf");
  await expect(page.locator(".cm-notice--warn")).toBeVisible({ timeout: 20_000 });
  // Otomatik tanıma da başlamış olabilir: düğme hâlâ duruyorsa elle başlat.
  await page.getByRole("button", { name: "Metni tanıt (OCR)" }).click({ timeout: 3_000 }).catch(() => {});
  await expect(page.locator('.cm-page[data-page="0"] .textLayer')).toContainText("Standart sapma", { timeout: 150_000 });
  await expect(page.getByRole("progressbar", { name: "OCR ilerlemesi" })).toHaveCount(0, { timeout: 150_000 });
  await page.locator(".cm-stage").focus();
  await page.keyboard.press("Control+f");
  await page.locator(".cm-search input").fill("standart sapma");
  await expect(page.locator(".cm-searchhit").first()).toBeVisible();
});
