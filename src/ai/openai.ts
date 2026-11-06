import OpenAI from "openai";
import { SYSTEM, promptText, type AskBase, type AskResult } from "./prompt";

// OpenAI (kendi anahtarınla) ve OpenAI uyumlu yerel sunucular (Ollama, LM Studio): tarayıcıdan doğrudan.

export async function ask(o: AskBase, opts: { apiKey: string; model: string; baseURL?: string }): Promise<AskResult> {
  const client = new OpenAI({ apiKey: opts.apiKey || "yerel", baseURL: opts.baseURL, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: o.system ?? SYSTEM }];
  for (const t of o.history.slice(-4)) {
    messages.push({ role: "user", content: t.question }, { role: "assistant", content: t.answer });
  }
  messages.push({
    role: "user",
    content: o.image
      ? [{ type: "image_url", image_url: { url: `data:${o.image.mediaType};base64,${o.image.base64}` } }, { type: "text", text: promptText(o) }]
      : promptText(o),
  });
  const stream = await client.chat.completions.create(
    { model: opts.model, messages, stream: true, stream_options: { include_usage: true } },
    { signal: o.signal },
  );
  let text = "";
  let stop: string | null = null;
  let usage: AskResult["usage"];
  for await (const chunk of stream) {
    const c = chunk.choices[0];
    const d = c?.delta?.content;
    if (d) {
      text += d;
      o.onText(d);
    }
    if (c?.finish_reason) stop = c.finish_reason === "length" ? "max_tokens" : c.finish_reason === "content_filter" ? "refusal" : c.finish_reason;
    if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
  }
  return { text, stop, usage };
}

export function friendlyError(err: unknown, local: boolean, name = "Sağlayıcı"): { title: string; text: string } {
  if (err instanceof OpenAI.APIUserAbortError) return { title: "Durduruldu", text: "Cevap yarıda kesildi. İstersen yeniden üret." };
  if (local && err instanceof OpenAI.APIConnectionError) {
    return { title: "Yerel sunucuya bağlanılamadı", text: "Ollama ya da LM Studio açık mı? Adresi Ayarlar > AI'dan kontrol et; tarayıcıdan erişim için sunucuda CORS'a izin verilmeli (Ollama: OLLAMA_ORIGINS)." };
  }
  if (err instanceof OpenAI.AuthenticationError) return { title: "API anahtarı geçersiz", text: "Ayarlar > AI'dan anahtarını kontrol et ya da yenisini gir." };
  if (err instanceof OpenAI.NotFoundError) return { title: "Model bulunamadı", text: `Model adını Ayarlar > AI'dan kontrol et ("Anahtarı dene ve modelleri yükle" ile listeden seç). ${name}: „${err.message.replace(/^\d+\s*/, "").slice(0, 160)}"` };
  if (err instanceof OpenAI.RateLimitError) {
    // Bekleme süresi: retry-after başlığı (CORS'ta gizli olabilir) ya da mesajdaki "try again in 1m2.5s".
    const m = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(err.message);
    const fromMsg = m && (m[1] || m[2] || m[3]) ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : NaN;
    const wait = Number(err.headers?.get?.("retry-after") ?? fromMsg);
    const when = Number.isFinite(wait) && wait > 0 ? (wait < 90 ? `${Math.ceil(wait)} sn sonra` : `Yaklaşık ${Math.ceil(wait / 60)} dk sonra`) : "Biraz sonra";
    return { title: `${name} sınırı doldu`, text: `Ücretsiz katmanın dakikalık ya da günlük sınırına ulaşıldı. ${when} yeniden dene ya da Ayarlar > AI'dan başka bir sağlayıcıya geç.` };
  }
  if (err instanceof OpenAI.BadRequestError) return { title: "İstek kabul edilmedi", text: `${name} isteği reddetti: „${err.message.replace(/^\d+\s*/, "").slice(0, 220)}". Model adını ya da kapsamı kontrol et.` };
  if (err instanceof OpenAI.PermissionDeniedError) return { title: "Bu anahtarın izni yok", text: `${name}: „${err.message.replace(/^\d+\s*/, "").slice(0, 220)}"` };
  if (err instanceof OpenAI.APIConnectionError) return { title: "Bağlantı kurulamadı", text: "İnternet bağlantını kontrol edip yeniden dene." };
  if (err instanceof OpenAI.APIError) return { title: "AI cevap veremedi", text: `Sağlayıcı ${err.status ?? ""} hatası döndürdü. Biraz sonra yeniden dene.`.replace("  ", " ") };
  return { title: "AI cevap veremedi", text: `Beklenmeyen bir sorun oldu: ${err instanceof Error ? err.message : String(err)}` };
}

/** OpenAI uyumlu servisteki modeller (anahtar denemesi de olur). */
export async function listModels(apiKey: string, baseURL: string): Promise<string[]> {
  const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true, maxRetries: 0 });
  const ids: string[] = [];
  for await (const m of client.models.list()) ids.push(m.id);
  return ids.sort();
}
