import { expect, test } from "@playwright/test";
import { collectErrors, openSample, selectSpan } from "./helpers";

test("Yaz modu: kalemle çizilir, geri alınır", async ({ page }) => {
  const errors = collectErrors(page);
  await openSample(page);
  await page.getByRole("button", { name: "Yaz", exact: true }).first().click();
  await page.keyboard.press("p");
  const box = (await page.locator('.cm-page[data-page="0"]').boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 200);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 120 + i * 20, box.y + 200 + (i % 2) * 15);
  await page.mouse.up();
  await expect(page.locator('.cm-page[data-page="0"] .cm-ink path')).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator('.cm-page[data-page="0"] .cm-ink path')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Tekrar modu: vurgudan kart, cevap ve not verme", async ({ page }) => {
  await openSample(page);
  await selectSpan(page, 2);
  await page.keyboard.press("4");
  await expect(page.locator(".cm-hlrect").first()).toBeVisible();
  await page.keyboard.press("Alt+t");
  await expect(page.locator(".cm-review")).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("3");
  await expect(page.locator(".cm-review")).toContainText(/bitti|Bugünlük|kart yok/i);
});
