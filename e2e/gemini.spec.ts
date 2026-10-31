import { expect, test } from "@playwright/test";
import { collectErrors, openSample } from "./helpers";

// Gemini sunucusu taklit edilir: istek biçimi, akış (SSE), model listesi ve CSP denenir.
test("Gemini: anahtarla kur, modelleri yükle, sayfayı özetlet", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "ağ taklidi bir tarayıcıda yeterli");
  const errors = collectErrors(page);
  let body: { systemInstruction?: unknown; contents: { parts: { text?: string }[] }[] } | null = null;
  let key = "";
  await page.route("https://generativelanguage.googleapis.com/v1beta/models?*", (route) =>
    route.fulfill({ json: { models: [
      { name: "models/gemini-9-flash", displayName: "Gemini 9 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] },
    ] } }));
  await page.route("https://generativelanguage.googleapis.com/v1beta/models/*:streamGenerateContent*", async (route) => {
    key = route.request().headers()["x-goog-api-key"];
    body = route.request().postDataJSON();
    const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\r\n\r\n`;
    await route.fulfill({
      headers: { "content-type": "text/event-stream" },
      body: chunk({ candidates: [{ content: { parts: [{ text: "Normal dağılım çan eğrisidir " }] } }] })
        + chunk({ candidates: [{ content: { parts: [{ text: "[s. 1: \"The normal distribution\"]." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 } }),
    });
  });
  await openSample(page);
  await page.locator(".cm-bar__file").click();
  await page.getByRole("menuitem", { name: "Ayarlar" }).click();
  await page.getByRole("button", { name: /AI'yı aç|AI ayarları|Değiştir/ }).first().click();
  await page.getByRole("radio", { name: /Gemini/ }).click();
  await page.getByLabel("Google Gemini API anahtarı").fill("AIzaSyTEST_test_test_test_test_1234567");
  await page.getByRole("button", { name: "Anahtarı dene ve modelleri yükle" }).click();
  await expect(page.getByText("Anahtar çalışıyor · 1 model bulundu.")).toBeVisible();
  await page.getByLabel("Model").selectOption("gemini-9-flash");
  await page.getByRole("button", { name: "Kaydet" }).last().click();
  await page.keyboard.press("Escape");
  await page.locator(".cm-stage").focus();
  await page.keyboard.press("Control+j");
  await page.getByRole("button", { name: "Bu sayfayı özetle" }).click();
  await expect(page.locator(".cm-ai")).toContainText("Normal dağılım çan eğrisidir");
  expect(key).toBe("AIzaSyTEST_test_test_test_test_1234567");
  expect(JSON.stringify(body!.contents.at(-1))).toContain("Bu sayfayı kısa maddeler halinde özetle");
  expect(errors).toEqual([]);
});
