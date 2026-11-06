import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

async function newNotebook(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Yeni not defteri" }).click();
  await page.getByRole("radio", { name: "Çizgili" }).click();
  await page.getByRole("radio", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "Oluştur" }).click();
  await expect(page.locator(".cm-page")).toHaveCount(5, { timeout: 20_000 });
  await expect(page.locator(".cm-palette")).toBeVisible();
}

async function stroke(page: Page, pts: [number, number][]): Promise<void> {
  const box = (await page.locator('.cm-page[data-page="0"]').boundingBox())!;
  await page.mouse.move(box.x + pts[0][0], box.y + pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
  await page.mouse.up();
}

test("Not defteri: oluştur, yaz, sona sayfa ekle", async ({ page }) => {
  const errors = collectErrors(page);
  await newNotebook(page);
  await page.keyboard.press("p");
  await stroke(page, [[80, 120], [200, 140], [320, 120]]);
  await expect(page.locator('.cm-page[data-page="0"] .cm-ink path')).toHaveCount(1);
  await page.locator(".cm-pages__add").click();
  await expect(page.locator(".cm-page")).toHaveCount(6, { timeout: 20_000 });
  // İşaretler yeni sürüme taşındı.
  await expect(page.locator('.cm-page[data-page="0"] .cm-ink path')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Kement: seç, boyutlandır, sil; kısmi silgi", async ({ page }) => {
  await newNotebook(page);
  await page.keyboard.press("p");
  await stroke(page, [[80, 200], [300, 200]]);
  await stroke(page, [[80, 260], [300, 260]]);
  await page.keyboard.press("e");
  await stroke(page, [[190, 180], [190, 220]]);
  // Kısmi silgi ilk çizgiyi ikiye böler.
  await expect(page.locator('.cm-page[data-page="0"] .cm-ink path')).toHaveCount(3);
  await page.keyboard.press("l");
  await stroke(page, [[60, 240], [330, 240], [330, 280], [60, 280], [60, 241]]);
  await expect(page.locator(".cm-selbox__count")).toHaveText("1");
  await page.locator(".cm-selbox__bar").getByRole("button", { name: "Sil" }).click();
  await expect(page.locator('.cm-page[data-page="0"] .cm-ink path')).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator('.cm-page[data-page="0"] .cm-ink path')).toHaveCount(3);
});

test("Biçimli not: yapılacak kutusu ve kalın yazı", async ({ page }) => {
  await newNotebook(page);
  await page.keyboard.press("t");
  const box = (await page.locator('.cm-page[data-page="0"]').boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 300);
  await expect(page.locator(".cm-formatbar")).toBeVisible();
  await page.locator('.cm-formatbar__btn[title="Yapılacak"]').click();
  await page.keyboard.type("Ödev");
  await page.keyboard.press("Escape");
  const check = page.locator(".cm-textbox .cm-rich__check input");
  await expect(check).toBeVisible();
  await check.click();
  await expect(check).toBeChecked();
});

test("Metin yazma: dışarı tıklamak yalnızca bitirir, yazı boyutu uygulanır", async ({ page }) => {
  await newNotebook(page);
  await page.keyboard.press("t");
  const box = (await page.locator('.cm-page[data-page="0"]').boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 200);
  await expect(page.locator(".cm-textbox[contenteditable]")).toBeVisible();
  // Yazarken boyut düğmesi imleci almaz; yazı kaybolmaz.
  await page.getByRole("button", { name: "Yazı boyutu: büyük" }).click();
  await page.keyboard.type("Başlık");
  await page.mouse.click(box.x + 300, box.y + 500);
  await expect(page.locator(".cm-textbox")).toHaveCount(1);
  await expect(page.locator(".cm-textbox[contenteditable]")).toHaveCount(0);
  await expect(page.locator(".cm-textbox")).toHaveText("Başlık");
  expect(await page.locator(".cm-textbox").evaluate((el) => (el as HTMLElement).style.getPropertyValue("--fs"))).toBe("22px");
  // İkinci tıklama yeni kutu açar; Ctrl Enter bitirir.
  await page.mouse.click(box.x + 80, box.y + 400);
  await page.keyboard.type("İkinci not");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".cm-textbox")).toHaveCount(2);
  await expect(page.locator(".cm-textbox[contenteditable]")).toHaveCount(0);
});

test("Son açılanlar: klasör, etiket, kapaklar ve erişilebilirlik", async ({ page, browserName }) => {
  await newNotebook(page);
  await page.locator(".cm-bar__file").click();
  await page.getByRole("menuitem", { name: "Son açılanlar" }).click();
  await page.getByRole("button", { name: /düzenle$/ }).first().click();
  await page.getByRole("menuitem", { name: "Klasöre taşı…" }).click();
  await page.locator(".cm-dialog input").first().fill("Matematik");
  await page.getByRole("button", { name: "Taşı" }).click();
  await expect(page.getByRole("button", { name: "▸ Matematik" })).toBeVisible();
  await page.getByRole("button", { name: "Kapaklar" }).click();
  await expect(page.locator(".cm-cover")).toHaveCount(1);
  if (browserName === "chromium") {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});
