import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM, userMessage, type AiContext, type Turn } from "./prompt";

// AI yalnızca kullanıcının açıkça başlattığı istekte, kullanıcının kendi API anahtarıyla
// tarayıcıdan doğrudan Anthropic'e gider. Arada bizim sunucumuz yok; hiçbir şey kendiliğinden gönderilmez.
// Bu modül (ve SDK) yalnızca ilk soruda yüklenir.

/** Sunucu tarafı yedek model yalnızca bunu destekleyen modellerde istenir. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export interface AskOptions {
  apiKey: string;
  model: string;
  history: Turn[];
  ctx: AiContext;
  question: string;
  signal: AbortSignal;
  onText(delta: string): void;
}

export interface AskResult {
  text: string;
  stop: string | null;
}

export async function ask(o: AskOptions): Promise<AskResult> {
  // Anahtar kullanıcının kendi tarayıcısında, kendi isteği için kullanılır (kendi anahtarını getir modeli).
  const client = new Anthropic({ apiKey: o.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  // Son birkaç tur: takip sorusu anlaşılsın, ama her istek eski kapsamları yeniden göndermesin.
  for (const t of o.history.slice(-4)) {
    messages.push({ role: "user", content: t.question });
    messages.push({ role: "assistant", content: t.answer });
  }
  messages.push({ role: "user", content: userMessage(o.ctx, o.question) });

  const fallback = FALLBACK_MODELS.has(o.model);
  const stream = client.beta.messages.stream(
    {
      model: o.model,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    },
    { signal: o.signal },
  );
  let text = "";
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      text += ev.delta.text;
      o.onText(ev.delta.text);
    }
  }
  const final = await stream.finalMessage();
  return { text, stop: final.stop_reason };
}

/** Hata: ne oldu + ne yapabilirsin. Okumayı asla engellemez. */
export function friendlyError(err: unknown): { title: string; text: string } {
  if (err instanceof Anthropic.APIUserAbortError) return { title: "Durduruldu", text: "Cevap yarıda kesildi. İstersen yeniden üret." };
  if (err instanceof Anthropic.AuthenticationError) return { title: "API anahtarı geçersiz", text: "Ayarlar > AI'dan anahtarını kontrol et ya da yenisini gir." };
  if (err instanceof Anthropic.PermissionDeniedError) return { title: "Bu anahtarın izni yok", text: "Anahtarın bu modele erişemiyor. Ayarlar > AI'dan başka bir model seç ya da hesabını kontrol et." };
  if (err instanceof Anthropic.RateLimitError) return { title: "İstek sınırına ulaşıldı", text: "Sağlayıcı şu an daha fazla istek kabul etmiyor ya da kredin bitti. Biraz bekleyip yeniden dene." };
  if (err instanceof Anthropic.BadRequestError) return { title: "İstek kabul edilmedi", text: "Kapsam çok uzun ya da hesabında kredi kalmamış olabilir. Daha dar bir kapsam seçip yeniden dene." };
  if (err instanceof Anthropic.InternalServerError) return { title: "Sağlayıcı şu an yoğun", text: "Bir süre sonra yeniden dene." };
  if (err instanceof Anthropic.APIConnectionError) return { title: "Bağlantı kurulamadı", text: "İnternet bağlantını kontrol edip yeniden dene." };
  if (err instanceof Anthropic.APIError) return { title: "AI cevap veremedi", text: `Sağlayıcı ${err.status ?? ""} hatası döndürdü. Biraz sonra yeniden dene.`.replace("  ", " ") };
  return { title: "AI cevap veremedi", text: "Beklenmeyen bir sorun oldu. Yeniden dene." };
}
