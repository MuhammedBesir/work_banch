import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, dropPdf } from "./helpers";

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
  // Yazarken taşı ve genişlet: imleç kutuda kalır, yazmaya devam edilir.
  await page.mouse.click(box.x + 80, box.y + 300);
  await page.keyboard.type("Taşı");
  const editing = page.locator(".cm-textbox[contenteditable]");
  const b0 = (await editing.boundingBox())!;
  const g = (await page.locator(".cm-formatbar__grip").boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 120, g.y + 50, { steps: 5 });
  await page.mouse.up();
  const hd = (await page.locator(".cm-edithandle").boundingBox())!;
  await page.mouse.move(hd.x + hd.width / 2, hd.y + hd.height / 2);
  await page.mouse.down();
  await page.mouse.move(hd.x + 100, hd.y + hd.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.type(" sonra");
  const b1 = (await editing.boundingBox())!;
  expect(b1.x - b0.x).toBeGreaterThan(100);
  expect(b1.width - b0.width).toBeGreaterThan(80);
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-textbox", { hasText: "Taşı sonra" })).toHaveCount(1);
});

test("Dersler: oluştur, sürükleyerek taşı, derse PDF ekle, kapaklar ve erişilebilirlik", async ({ page, browserName }) => {
  await newNotebook(page);
  // PDF'ten çık: kitaplığa dön.
  await page.getByRole("button", { name: "Kitaplığa dön" }).click();
  await expect(page.getByRole("heading", { name: "Derslerim" })).toBeVisible();
  // Boş ders oluştur; içine girilir, boş durum görünür.
  await page.locator(".cm-foldercard--new").click();
  await page.locator(".cm-dialog input").fill("Matematik");
  await page.getByRole("button", { name: "Oluştur" }).click();
  await expect(page.getByRole("heading", { name: "Matematik", exact: true })).toBeVisible();
  await expect(page.getByText("Bu derste henüz PDF yok")).toBeVisible();
  // Kitaplığa dön, dosyayı ders kartına sürükle.
  await page.getByRole("button", { name: "Kitaplık" }).click();
  await expect(page.getByRole("button", { name: "Matematik dersi, 0 PDF" })).toBeVisible();
  await page.locator(".cm-table tbody tr").first().dragTo(page.getByRole("button", { name: /Matematik dersi/ }));
  await expect(page.getByRole("button", { name: "Matematik dersi, 1 PDF" })).toBeVisible();
  // Dersin içinde dosya listelenir; menüden de taşınabilir.
  await page.getByRole("button", { name: "Matematik dersi, 1 PDF" }).click();
  await expect(page.locator(".cm-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: /düzenle$/ }).first().click();
  await expect(page.getByRole("menuitem", { name: "Dersten çıkar" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Kapaklar" }).click();
  await expect(page.locator(".cm-cover")).toHaveCount(1);
  if (browserName === "chromium") {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
  // Dersteyken açılan PDF o derse eklenir; kapatınca derse dönülür.
  await dropPdf(page, "ders.pdf", "Hafta2.pdf");
  await expect(page.locator('.cm-page[data-page="0"] .textLayer span').first()).toBeAttached({ timeout: 20_000 });
  await page.getByRole("button", { name: "Kitaplığa dön" }).click();
  await expect(page.getByRole("heading", { name: "Matematik", exact: true })).toBeVisible();
  await expect(page.locator(".cm-cover")).toHaveCount(2);
});
