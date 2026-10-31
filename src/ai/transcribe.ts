import OpenAI from "openai";

// Kaydı yazıya dök: OpenAI (kendi anahtarınla, whisper-1). Kayıt yalnızca kullanıcı isteyince gönderilir.

export const MAX_BYTES = 25 * 1024 * 1024;

export async function transcribe(blob: Blob, mime: string, apiKey: string, signal: AbortSignal): Promise<{ t: number; text: string }[]> {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const file = new File([blob], `kayit.${ext}`, { type: mime.split(";")[0] });
  const r = await client.audio.transcriptions.create(
    { file, model: "whisper-1", language: "tr", response_format: "verbose_json", timestamp_granularities: ["segment"] },
    { signal },
  );
  const segs = (r.segments ?? []).map((s) => ({ t: Math.round(s.start * 1000), text: s.text.trim() })).filter((s) => s.text);
  return segs.length ? segs : r.text.trim() ? [{ t: 0, text: r.text.trim() }] : [];
}
