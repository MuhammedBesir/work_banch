import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { SYSTEM, promptText, type AskBase, type AskResult } from "./prompt";

// Cihazda model (WebLLM + WebGPU): metin tarayıcıdan hiç çıkmaz. Model bir kez indirilir ve
// tarayıcının önbelleğinde kalır. Kısa açıklama ve basitleştirmede iyi, uzun özette zayıf.

export class DeviceError extends Error {
  constructor(public kind: "webgpu" | "load", message: string) {
    super(message);
  }
}

/** WebGPU yoksa cihazda seçeneği devre dışı ve nedeni yazılır. */
export async function webgpuStatus(): Promise<{ ok: boolean; reason?: string }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return { ok: false, reason: "Bu tarayıcıda WebGPU yok (Safari ve eski tarayıcılarda olmayabilir). Chrome ya da Edge'in güncel sürümünü dene." };
  try {
    return (await gpu.requestAdapter()) ? { ok: true } : { ok: false, reason: "Ekran kartına erişilemedi (WebGPU adaptörü yok)." };
  } catch {
    return { ok: false, reason: "Ekran kartına erişilemedi (WebGPU adaptörü yok)." };
  }
}

let engine: MLCEngineInterface | null = null;
let loaded = "";
let loading: Promise<MLCEngineInterface> | null = null;

async function getEngine(model: string, onProgress?: AskBase["onProgress"]): Promise<MLCEngineInterface> {
  if (engine && loaded === model) return engine;
  if (loading) return loading;
  const status = await webgpuStatus();
  if (!status.ok) throw new DeviceError("webgpu", status.reason!);
  loading = (async () => {
    const webllm = await import("@mlc-ai/web-llm");
    await engine?.unload();
    const e = await webllm.CreateMLCEngine(model, { initProgressCallback: (r) => onProgress?.(r.progress, r.text) });
    engine = e;
    loaded = model;
    return e;
  })();
  try {
    return await loading;
  } catch (err) {
    throw new DeviceError("load", err instanceof Error ? err.message : String(err));
  } finally {
    loading = null;
  }
}

export async function ask(o: AskBase, model: string): Promise<AskResult> {
  const e = await getEngine(model, o.onProgress);
  const onAbort = () => e.interruptGenerate();
  o.signal.addEventListener("abort", onAbort);
  try {
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [{ role: "system", content: o.system ?? SYSTEM }];
    for (const t of o.history.slice(-2)) messages.push({ role: "user", content: t.question }, { role: "assistant", content: t.answer });
    messages.push({ role: "user", content: promptText(o) });
    const stream = await e.chat.completions.create({ messages, stream: true, stream_options: { include_usage: true } });
    let text = "";
    let stop: string | null = null;
    let usage: AskResult["usage"];
    for await (const chunk of stream) {
      const d = chunk.choices[0]?.delta?.content;
      if (d) {
        text += d;
        o.onText(d);
      }
      if (chunk.choices[0]?.finish_reason) stop = chunk.choices[0].finish_reason === "length" ? "max_tokens" : chunk.choices[0].finish_reason;
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
    }
    if (o.signal.aborted) throw new DOMException("Durduruldu", "AbortError");
    return { text, stop, usage };
  } finally {
    o.signal.removeEventListener("abort", onAbort);
  }
}

export function friendlyError(err: unknown): { title: string; text: string } {
  if (err instanceof DOMException && err.name === "AbortError") return { title: "Durduruldu", text: "Cevap yarıda kesildi. İstersen yeniden üret." };
  if (err instanceof DeviceError && err.kind === "webgpu") return { title: "Cihazda model çalışamıyor", text: err.message };
  if (err instanceof DeviceError) return { title: "Model yüklenemedi", text: "İnternet bağlantını ve boş disk alanını (en az 2 GB) kontrol et, sonra yeniden dene. Ayarlar > AI'dan daha küçük bir model de seçebilirsin." };
  const msg = err instanceof Error ? err.message : "";
  if (/context|token/i.test(msg)) return { title: "Kapsam cihazdaki model için çok uzun", text: "Seçim ya da Bu sayfa gibi daha dar bir kapsam seç." };
  return { title: "Cihazdaki model cevap veremedi", text: "Sekmeyi yenileyip yeniden dene; sorun sürerse daha küçük bir model seç." };
}
