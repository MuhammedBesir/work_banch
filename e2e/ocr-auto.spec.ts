import { expect, test } from "@playwright/test";
import { dropPdf } from "./helpers";

// Karışık sayfa: PDF metni + içinde yazı olan resim. Resimdeki yazı kendiliğinden tanınır,
// PDF metni bozulmadan katmana eklenir ve aranabilir olur.
test("Resimdeki yazı otomatik tanınır ve aranır", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium" || info.project.name !== "chromium", "OCR yalnızca masaüstü Chromium'da denenir");
  test.setTimeout(180_000);
  await page.goto("/");
  await dropPdf(page, "karisik.pdf");
  const layer = page.locator('.cm-page[data-page="0"] .textLayer');
  await expect(layer).toContainText("normal selectable text", { timeout: 20_000 });
  await expect(page.locator(".cm-ocrpill")).toBeVisible({ timeout: 20_000 });
  await expect(layer.locator("span.is-ocrx").first()).toBeAttached({ timeout: 150_000 });
  await expect(layer).toContainText(/gizli/i);
  // PDF'in kendi metni tekrar eklenmez.
  expect(await layer.locator("span.is-ocrx", { hasText: "selectable" }).count()).toBe(0);
  await expect(page.locator(".cm-ocrpill")).toHaveCount(0, { timeout: 30_000 });
  await page.locator(".cm-stage").focus();
  await page.keyboard.press("Control+f");
  await page.locator(".cm-search input").fill("gizli");
  await expect(page.locator(".cm-searchhit").first()).toBeVisible();
});
