import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))).toString("base64");

/** Dosyayı sürükle-bırak ile açar (her tarayıcıda dosya seçiciden daha kararlı). */
export async function dropPdf(page: Page, fixtureName: string, as = fixtureName): Promise<void> {
  await page.evaluate(({ b64, as }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], as, { type: "application/pdf" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, cancelable: true }));
  }, { b64: fixture(fixtureName), as });
}

export async function openSample(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".cm-drop")).toBeVisible();
  await dropPdf(page, "ders.pdf", "IST201_Bolum4.pdf");
  await expect(page.locator('.cm-page[data-page="0"] .textLayer span').first()).toBeAttached({ timeout: 20_000 });
}

/** Sayfa 1'deki n'inci metin parçasının bir kısmını fareyle seçer. */
export async function selectSpan(page: Page, n: number, part = 0.7): Promise<void> {
  const span = page.locator('.cm-page[data-page="0"] .textLayer span').nth(n);
  await span.scrollIntoViewIfNeeded();
  const box = (await span.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * part, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".cm-floatwrap:not([hidden])")).toBeVisible();
}

/** Dışa aktar menüsünden bir biçim seçer. */
export async function openExport(page: Page, item: RegExp): Promise<void> {
  await page.locator(".cm-bar").getByRole("button", { name: "Dışa aktar" }).click();
  await page.getByRole("menuitem", { name: item }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Konsol hataları: her test sonunda boş olmalı. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}
