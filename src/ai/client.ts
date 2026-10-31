import type { AiSettings } from "../types";
import type { AskBase, AskResult } from "./prompt";

// Sağlayıcıya göre istek. Her sağlayıcının SDK'sı ayrı parça olarak yalnızca kullanılınca yüklenir.

export async function ask(ai: AiSettings, o: AskBase): Promise<AskResult> {
  switch (ai.mode) {
    case "anthropic":
      return (await import("./anthropic")).ask(o, ai.keys.anthropic, ai.models.anthropic);
    case "openai":
      return (await import("./openai")).ask(o, { apiKey: ai.keys.openai, model: ai.models.openai });
    case "gemini":
      return (await import("./gemini")).ask(o, ai.keys.gemini, ai.models.gemini);
    case "local":
      return (await import("./openai")).ask(o, { apiKey: "", model: ai.models.local, baseURL: ai.localUrl.replace(/\/+$/, "") });
    case "device":
      return (await import("./device")).ask(o, ai.models.device);
    default:
      throw new Error("AI kapalı");
  }
}

export async function friendlyError(ai: AiSettings, err: unknown): Promise<{ title: string; text: string }> {
  switch (ai.mode) {
    case "anthropic":
      return (await import("./anthropic")).friendlyError(err);
    case "openai":
    case "local":
      return (await import("./openai")).friendlyError(err, ai.mode === "local");
    case "gemini":
      return (await import("./gemini")).friendlyError(err);
    case "device":
      return (await import("./device")).friendlyError(err);
    default:
      return { title: "AI kapalı", text: "Ayarlar > AI'dan aç." };
  }
}

/** Bulut sağlayıcısının anahtarı girilmiş mi; yerel ve cihazda anahtar gerekmez. */
export function ready(ai: AiSettings): boolean {
  if (ai.mode === "anthropic") return !!ai.keys.anthropic;
  if (ai.mode === "openai") return !!ai.keys.openai;
  if (ai.mode === "gemini") return !!ai.keys.gemini;
  return ai.mode !== "off";
}

/** Görsel (el yazısı) gönderebilen sağlayıcı: Claude, OpenAI ve Gemini. */
export function visionReady(ai: AiSettings): boolean {
  return (ai.mode === "anthropic" || ai.mode === "openai" || ai.mode === "gemini") && ready(ai);
}

/** Belgeye bağlı olmayan tek seferlik istek (el yazısı, matematik, özet, çeviri). */
export async function askSimple(
  ai: AiSettings,
  o: { system: string; text: string; image?: AskBase["image"]; signal: AbortSignal; onText?(delta: string): void; onProgress?: AskBase["onProgress"] },
): Promise<string> {
  const r = await ask(ai, {
    history: [], ctx: { label: "", pages: [] }, question: o.text, signal: o.signal, raw: true, system: o.system,
    image: o.image, onText: o.onText ?? (() => {}), onProgress: o.onProgress,
  });
  return r.text.trim();
}
