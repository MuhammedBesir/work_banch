import { SYSTEM, promptText, type AskBase, type AskResult } from "./prompt";

// Google Gemini (kendi anahtarınla): tarayıcıdan doğrudan generativelanguage.googleapis.com'a, SDK'sız.
// Anahtar yalnızca istek başlığında (x-goog-api-key) gider; arada sunucu yok.

const API = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  constructor(public status: number, public reason: string, message: string) {
    super(message);
  }
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function fail(res: Response): Promise<never> {
  let reason = "";
  let message = res.statusText;
  try {
    const j = (await res.json()) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } };
    message = j.error?.message ?? message;
    reason = j.error?.details?.find((d) => d.reason)?.reason ?? j.error?.status ?? "";
  } catch {
    /* gövde yok */
  }
  throw new GeminiError(res.status, reason, message);
}

/** Akışlı istek: SSE satırlarından metni toplar. */
async function stream(model: string, apiKey: string, body: unknown, signal: AbortSignal, onText: (t: string) => void): Promise<AskResult> {
  const res = await fetch(`${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) await fail(res);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let text = "";
  let stop: string | null = null;
  let usage: AskResult["usage"];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const ev = JSON.parse(line.slice(5)) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        promptFeedback?: { blockReason?: string };
      };
      if (ev.promptFeedback?.blockReason) stop = "refusal";
      const c = ev.candidates?.[0];
      for (const p of c?.content?.parts ?? []) {
        if (p.text && !p.thought) {
          text += p.text;
          onText(p.text);
        }
      }
      if (c?.finishReason && c.finishReason !== "FINISH_REASON_UNSPECIFIED") {
        stop = c.finishReason === "MAX_TOKENS" ? "max_tokens" : c.finishReason === "STOP" ? "end_turn" : /SAFETY|PROHIBITED|BLOCKLIST|RECITATION/.test(c.finishReason) ? "refusal" : c.finishReason.toLowerCase();
      }
      if (ev.usageMetadata) usage = { input: ev.usageMetadata.promptTokenCount ?? 0, output: (ev.usageMetadata.candidatesTokenCount ?? 0) + (ev.usageMetadata.thoughtsTokenCount ?? 0) };
    }
  }
  return { text, stop, usage };
}

export async function ask(o: AskBase, apiKey: string, model: string): Promise<AskResult> {
  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  for (const t of o.history.slice(-4)) {
    contents.push({ role: "user", parts: [{ text: t.question }] }, { role: "model", parts: [{ text: t.answer }] });
  }
  contents.push({
    role: "user",
    parts: [...(o.image ? [{ inline_data: { mime_type: o.image.mediaType, data: o.image.base64 } }] : []), { text: promptText(o) }],
  });
  return stream(model, apiKey, {
    systemInstruction: { parts: [{ text: o.system ?? SYSTEM }] },
    contents,
    generationConfig: { maxOutputTokens: 16000 },
  }, o.signal, o.onText);
}

/** Anahtarın kullanabildiği sohbet modelleri (yeniden eskiye). */
export async function listModels(apiKey: string): Promise<{ id: string; label: string }[]> {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) await fail(res);
  const j = (await res.json()) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
  return (j.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/.test(m.name) && !/embedding|image|tts|audio|live|veo|imagen|robotics|computer/.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name }))
    .reverse();
}

/** Ses kaydını yazıya dök (Gemini sesi doğrudan dinler). Zaman damgalı satırlar döner. */
export async function transcribe(blob: Blob, mime: string, apiKey: string, model: string, signal: AbortSignal): Promise<{ t: number; text: string }[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const r = await stream(model, apiKey, {
    systemInstruction: { parts: [{ text: "Bir üniversite dersinin ses kaydını yazıya dök. Her konuşma parçasını ayrı satıra [dk:sn] zaman damgasıyla yaz, örnek: [03:15] metin. Yalnızca konuşulanı yaz; özet, başlık ya da açıklama ekleme. Anlaşılmayan yer için [anlaşılmıyor] yaz." }] },
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime.split(";")[0], data: btoa(bin) } }, { text: "Bu kaydı yazıya dök." }] }],
    generationConfig: { maxOutputTokens: 32000 },
  }, signal, () => {});
  return parseStamped(r.text);
}

/** "[dk:sn] metin" satırları → parçalar. */
export function parseStamped(text: string): { t: number; text: string }[] {
  const out: { t: number; text: string }[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s*(.+)$/.exec(line);
    if (m) out.push({ t: ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000, text: m[4].trim() });
    else if (line.trim() && out.length) out[out.length - 1].text += ` ${line.trim()}`;
    else if (line.trim()) out.push({ t: 0, text: line.trim() });
  }
  return out;
}

export function friendlyError(err: unknown): { title: string; text: string } {
  if (err instanceof DOMException && err.name === "AbortError") return { title: "Durduruldu", text: "Cevap yarıda kesildi. İstersen yeniden üret." };
  if (err instanceof GeminiError) {
    if (err.reason === "API_KEY_INVALID" || (err.status === 400 && /API key/i.test(err.message))) return { title: "API anahtarı geçersiz", text: "Ayarlar > AI'dan Gemini anahtarını kontrol et; aistudio.google.com'dan yenisini alabilirsin." };
    if (err.status === 403) return { title: "Bu anahtarın izni yok", text: "Anahtar bu modele ya da Gemini API'ye erişemiyor. Google AI Studio'da anahtarın projesini kontrol et." };
    if (err.status === 404) return { title: "Model bulunamadı", text: "Ayarlar > AI'dan başka bir Gemini modeli seç (Modelleri yükle ile güncel listeyi al)." };
    if (err.status === 429) return { title: "İstek sınırına ulaşıldı", text: "Ücretsiz katmanın dakikalık ya da günlük sınırı dolmuş olabilir. Biraz bekleyip yeniden dene ya da daha hafif bir model seç." };
    if (err.status === 400) return { title: "İstek kabul edilmedi", text: "Kapsam çok uzun olabilir. Daha dar bir kapsam seçip yeniden dene." };
    if (err.status >= 500) return { title: "Gemini şu an yoğun", text: "Bir süre sonra yeniden dene." };
    return { title: "AI cevap veremedi", text: `Gemini ${err.status} hatası döndürdü. Biraz sonra yeniden dene.` };
  }
  if (err instanceof TypeError) return { title: "Bağlantı kurulamadı", text: "İnternet bağlantını kontrol edip yeniden dene." };
  return { title: "AI cevap veremedi", text: "Beklenmeyen bir sorun oldu. Yeniden dene." };
}
