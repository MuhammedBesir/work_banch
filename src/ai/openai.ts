import OpenAI from "openai";
import { SYSTEM, userMessage, type AskBase, type AskResult } from "./prompt";

// OpenAI (kendi anahtarınla) ve OpenAI uyumlu yerel sunucular (Ollama, LM Studio): tarayıcıdan doğrudan.

export async function ask(o: AskBase, opts: { apiKey: string; model: string; baseURL?: string }): Promise<AskResult> {
  const client = new OpenAI({ apiKey: opts.apiKey || "yerel", baseURL: opts.baseURL, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM }];
  for (const t of o.history.slice(-4)) {
    messages.push({ role: "user", content: t.question }, { role: "assistant", content: t.answer });
  }
  messages.push({ role: "user", content: userMessage(o.ctx, o.question) });
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

export function friendlyError(err: unknown, local: boolean): { title: string; text: string } {
  if (err instanceof OpenAI.APIUserAbortError) return { title: "Durduruldu", text: "Cevap yarıda kesildi. İstersen yeniden üret." };
  if (local && err instanceof OpenAI.APIConnectionError) {
    return { title: "Yerel sunucuya bağlanılamadı", text: "Ollama ya da LM Studio açık mı? Adresi Ayarlar > AI'dan kontrol et; tarayıcıdan erişim için sunucuda CORS'a izin verilmeli (Ollama: OLLAMA_ORIGINS)." };
  }
  if (err instanceof OpenAI.AuthenticationError) return { title: "API anahtarı geçersiz", text: "Ayarlar > AI'dan anahtarını kontrol et ya da yenisini gir." };
  if (err instanceof OpenAI.NotFoundError) return { title: "Model bulunamadı", text: "Model adını Ayarlar > AI'dan kontrol et." };
  if (err instanceof OpenAI.RateLimitError) return { title: "İstek sınırına ulaşıldı", text: "Sağlayıcı şu an daha fazla istek kabul etmiyor ya da kredin bitti. Biraz bekleyip yeniden dene." };
  if (err instanceof OpenAI.BadRequestError) return { title: "İstek kabul edilmedi", text: "Kapsam çok uzun olabilir. Daha dar bir kapsam seçip yeniden dene." };
  if (err instanceof OpenAI.APIConnectionError) return { title: "Bağlantı kurulamadı", text: "İnternet bağlantını kontrol edip yeniden dene." };
  if (err instanceof OpenAI.APIError) return { title: "AI cevap veremedi", text: `Sağlayıcı ${err.status ?? ""} hatası döndürdü. Biraz sonra yeniden dene.`.replace("  ", " ") };
  return { title: "AI cevap veremedi", text: "Beklenmeyen bir sorun oldu. Yeniden dene." };
}
