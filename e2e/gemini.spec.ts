import AxeBuilder from "@axe-core/playwright";
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
  await page.locator(".cm-dialog").getByRole("button", { name: /AI'yı aç|AI ayarları|Değiştir/ }).first().click();
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

  // AI tek başına kapanır: panel açıkken İşaretler'e döner, kapalıyken panel kapalı kalır.
  await page.getByRole("button", { name: "AI'yı kapat" }).click();
  await expect(page.locator(".cm-ai")).toBeHidden();
  await expect(page.locator(".cm-body")).not.toHaveClass(/no-panel/);
  await page.getByRole("button", { name: "İşaretler", exact: true }).click();
  await expect(page.locator(".cm-body")).toHaveClass(/no-panel/);
  await page.locator(".cm-stage").focus();
  await page.keyboard.press("Control+j");
  await expect(page.locator(".cm-ai")).toBeVisible();
  await page.getByRole("button", { name: "AI'yı kapat" }).click();
  await expect(page.locator(".cm-body")).toHaveClass(/no-panel/);
  expect(errors).toEqual([]);
});

test("Gemini yoğunken (503) yeniden dener ve daha hafif modele geçer", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "ağ taklidi bir tarayıcıda yeterli");
  test.setTimeout(60_000);
  const calls: string[] = [];
  await page.route("https://generativelanguage.googleapis.com/v1beta/models?*", (route) =>
    route.fulfill({ json: { models: ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"].map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ["generateContent"] })) } }));
  await page.route("https://generativelanguage.googleapis.com/v1beta/models/*:streamGenerateContent*", async (route) => {
    const model = /models\/([^:]+):/.exec(route.request().url())![1];
    calls.push(model);
    if (model === "gemini-pro-latest" || model === "gemini-flash-latest") {
      await route.fulfill({ status: 503, json: { error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } } });
      return;
    }
    await route.fulfill({
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Yedek modelden cevap." }] }, finishReason: "STOP" }] })}\r\n\r\n`,
    });
  });
  await openSample(page);
  await page.locator(".cm-bar__file").click();
  await page.getByRole("menuitem", { name: "Ayarlar" }).click();
  await page.locator(".cm-dialog").getByRole("button", { name: /AI'yı aç|AI ayarları|Değiştir/ }).first().click();
  await page.getByRole("radio", { name: /Gemini/ }).click();
  await page.getByLabel("Google Gemini API anahtarı").fill("AIzaSyTEST_test_test_test_test_1234567");
  await page.getByLabel("Model").selectOption("gemini-pro-latest");
  await page.getByRole("button", { name: "Kaydet" }).last().click();
  await page.keyboard.press("Escape");
  await page.locator(".cm-stage").focus();
  await page.keyboard.press("Control+j");
  await page.getByRole("button", { name: "Bu sayfayı özetle" }).click();
  await expect(page.locator(".cm-ai")).toContainText("Yedek modelden cevap.", { timeout: 20_000 });
  // Önizleme ve takma ad değil, hesabın kararlı Flash modeli seçilir.
  await expect(page.locator(".cm-ai")).toContainText("gemini-pro-latest yoğundu; bu cevap gemini-2.5-flash ile verildi.");
  expect(calls).toEqual(["gemini-pro-latest", "gemini-pro-latest", "gemini-pro-latest", "gemini-2.5-flash"]);
});

async function setupGemini(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".cm-bar__file").click();
  await page.getByRole("menuitem", { name: "Ayarlar" }).click();
  await page.locator(".cm-dialog").getByRole("button", { name: /AI'yı aç|AI ayarları|Değiştir/ }).first().click();
  await page.getByRole("radio", { name: /Gemini/ }).click();
  await page.getByLabel("Google Gemini API anahtarı").fill("AIzaSyTEST_test_test_test_test_1234567");
  await page.getByRole("button", { name: "Kaydet" }).last().click();
  await page.keyboard.press("Escape");
}

const sse = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] })}\r\n\r\n`;

test("Alan seç ve sor: alanın görüntüsü ve metni gider", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "ağ taklidi bir tarayıcıda yeterli");
  let body: { contents: { parts: ({ text?: string; inline_data?: { mime_type: string; data: string } })[] }[] } | null = null;
  await page.route("https://generativelanguage.googleapis.com/v1beta/models/*:streamGenerateContent*", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ headers: { "content-type": "text/event-stream" }, body: sse("Bu alanda normal dağılım anlatılıyor.") });
  });
  await openSample(page);
  await setupGemini(page);
  await page.locator(".cm-stage").focus();
  await page.keyboard.press("Shift+A");
  await expect(page.locator(".cm-areahint")).toBeVisible();
  const box = (await page.locator('.cm-page[data-page="0"]').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".cm-ai__sent")).toContainText("seçilen alan (s. 1)");
  await expect(page.locator(".cm-ai__sent")).toContainText("görüntü");
  await page.locator(".cm-ai__input").fill("Bu kısım ne anlatıyor?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-ai")).toContainText("Bu alanda normal dağılım anlatılıyor.");
  const parts = body!.contents.at(-1)!.parts;
  expect(parts[0].inline_data?.mime_type).toMatch(/image\//);
  expect(parts.at(-1)!.text).toContain("Normal Distribution");
  // Yeni AI paneli erişilebilirlik denetiminden geçer.
  const a11y = await new AxeBuilder({ page }).include(".cm-right").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(a11y.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("AI ile quiz: oluştur, cevapla, kontrol et", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "ağ taklidi bir tarayıcıda yeterli");
  const quiz = {
    title: "Normal dağılım",
    questions: [
      { type: "mc", q: "Normal dağılımı ne belirler?", options: ["Ortalama ve standart sapma", "Yalnızca medyan", "Mod", "Çarpıklık"], answer: 0, explanation: "Metin böyle diyor.", page: 1 },
      { type: "tf", q: "Sigma büyüyünce eğri sivrileşir.", answer: false, explanation: "Yayvanlaşır.", page: 1 },
      { type: "fill", q: "Eğri ___ ile yayvanlaşır.", answer: "sigma", page: 1 },
    ],
  };
  let prompt = "";
  await page.route("https://generativelanguage.googleapis.com/v1beta/models/*:streamGenerateContent*", async (route) => {
    prompt = JSON.stringify(route.request().postDataJSON());
    await route.fulfill({ headers: { "content-type": "text/event-stream" }, body: sse("```json\n" + JSON.stringify(quiz) + "\n```") });
  });
  await openSample(page);
  await setupGemini(page);
  await page.locator(".cm-quizzes").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "AI ile quiz oluştur" }).click();
  await page.getByRole("button", { name: "Boşluk doldurma" }).click();
  await page.getByRole("radio", { name: "5", exact: true }).click();
  await page.locator(".cm-dialog textarea").fill("vize formatında");
  await page.locator(".cm-dialog").getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.locator(".cm-quiz")).toHaveCount(1);
  expect(prompt).toContain("5 soruluk");
  expect(prompt).toContain("vize formatında");
  await page.locator(".cm-quiz__opt", { hasText: "Ortalama ve standart sapma" }).click();
  await page.locator(".cm-quiz__opt", { hasText: "Doğru" }).click();
  await page.locator(".cm-quiz__input").fill("Sigma");
  await page.getByRole("button", { name: "Kontrol et" }).click();
  await expect(page.locator(".cm-quiz__score")).toContainText("2 / 3");
  const a11y = await new AxeBuilder({ page }).include(".cm-quizzes").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(a11y.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

// Groq (OpenAI uyumlu): anahtar, model listesi, akış ve sınır dolunca anlaşılır mesaj.
test("Groq: ücretsiz anahtarla kur, sayfayı özetlet, sınır mesajı", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "ağ taklidi bir tarayıcıda yeterli");
  const errors = collectErrors(page);
  let auth = "";
  let limited = false;
  await page.route("https://api.groq.com/openai/v1/models", (route) =>
    route.fulfill({ json: { object: "list", data: [{ id: "llama-3.3-70b-versatile", object: "model" }, { id: "qwen/qwen3-32b", object: "model" }] } }));
  await page.route("https://api.groq.com/openai/v1/chat/completions", async (route) => {
    auth = route.request().headers()["authorization"];
    if (limited) {
      await route.fulfill({ status: 429, headers: { "retry-after": "42" }, json: { error: { message: "Rate limit reached for model llama-3.3-70b-versatile. Please try again in 42s.", type: "tokens", code: "rate_limit_exceeded" } } });
      return;
    }
    const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "llama-3.3-70b-versatile" };
    await route.fulfill({
      headers: { "content-type": "text/event-stream" },
      body: chunk({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Groq cevabı: çan eğrisi " } }] })
        + chunk({ ...base, choices: [{ index: 0, delta: { content: "[s. 1]." }, finish_reason: "stop" }] })
        + "data: [DONE]\n\n",
    });
  });
  await openSample(page);
  await page.locator(".cm-bar__file").click();
  await page.getByRole("menuitem", { name: "Ayarlar" }).click();
  await page.locator(".cm-dialog").getByRole("button", { name: /AI'yı aç|AI ayarları|Değiştir/ }).first().click();
  await page.getByRole("radio", { name: /Groq/ }).click();
  await page.getByLabel("Groq API anahtarı").fill("gsk_TEST_test_test_test_test_1234567");
  await page.getByRole("button", { name: "Anahtarı dene ve modelleri yükle" }).click();
  await expect(page.getByText(/Anahtar çalışıyor · 2 model bulundu/)).toBeVisible();
  await page.getByRole("button", { name: "Kaydet" }).last().click();
  await page.keyboard.press("Escape");
  await page.locator(".cm-stage").focus();
  await page.keyboard.press("Control+j");
  await page.getByRole("button", { name: "Bu sayfayı özetle" }).click();
  await expect(page.locator(".cm-ai")).toContainText("Groq cevabı: çan eğrisi");
  expect(auth).toBe("Bearer gsk_TEST_test_test_test_test_1234567");
  limited = true;
  await page.getByLabel("AI'ya sor").fill("Bir daha özetle");
  await page.getByLabel("AI'ya sor").press("Enter");
  await expect(page.locator(".cm-ai")).toContainText("Groq sınırı doldu");
  await expect(page.locator(".cm-ai")).toContainText("42 sn sonra");
  expect(errors.filter((e) => !/429|Too Many/.test(e))).toEqual([]);
});
