import { askSimple, friendlyError, ready, visionReady } from "../ai/client";
import type { AiSettings } from "../types";
import { h } from "../util";
import { canvasBase64 } from "../write/raster";
import { openDialog } from "./dialog";

// El yazısı → metin ve matematik çözme. Bu cihazda (OCR) ya da görsel destekleyen AI ile (Claude, OpenAI).

const TEXT_SYSTEM = `Görseldeki el yazısını metne çevir. Yalnızca yazılı metni ver; açıklama, başlık ya da yorum ekleme.
Satır sonlarını koru. Türkçe karakterleri (ç, ğ, ı, İ, ö, ş, ü) doğru yaz. Okuyamadığın kelime için [?] yaz.`;

const MATH_SYSTEM = `Bir üniversite öğrencisinin elle yazdığı matematik ifadesini ya da problemini oku ve çöz.
Biçim:
İfade: (okuduğun ifade, düz metinle)
Çözüm: (kısa adımlar, her adım ayrı satırda "- " ile)
Sonuç: (tek satır)
LaTeX kullanma; ×, ÷, √, π, ², ³, ≤, ≥, ∫, Σ gibi karakterler kullan. Türkçe yaz.
İfadenin bir kısmını okuyamazsan bunu açıkça söyle ve tahminini belirt; uydurma.`;

export interface HandwritingOptions {
  mode: "text" | "math";
  canvas: HTMLCanvasElement;
  ai: AiSettings;
  /** Bu cihazda tanıma (tesseract). */
  ocr(canvas: HTMLCanvasElement, onProgress: (text: string) => void): Promise<string>;
  insertText(text: string, removeInk: boolean): void;
  insertNote(text: string): void;
  openAiSettings(): void;
  copy(text: string): void;
}

export function openHandwriting(o: HandwritingOptions): void {
  const math = o.mode === "math";
  const d = openDialog({ title: math ? "Matematiği çöz" : "El yazısını metne çevir", width: 640 });
  const vision = visionReady(o.ai);
  let method: "ai" | "ocr" = vision ? "ai" : "ocr";
  let ctrl: AbortController | null = null;

  const preview = h("img", { class: "cm-hw__preview", src: o.canvas.toDataURL("image/png"), alt: "Seçilen el yazısı" });
  const status = h("p", { class: "cm-muted cm-hw__status", "aria-live": "polite" });
  const out = h("textarea", { class: "cm-input cm-hw__out", rows: math ? 9 : 5, "aria-label": math ? "Çözüm" : "Tanınan metin", spellcheck: "true", lang: "tr" });
  const removeInk = h("input", { type: "checkbox", id: "hw-remove" });
  const methodRow = h("div", { class: "cm-seg cm-seg--sm", role: "radiogroup", "aria-label": "Yöntem" });
  const renderMethods = () => {
    const opt = (m: "ai" | "ocr", label: string, disabled = false) =>
      h("button", { class: `cm-seg__btn${method === m ? " is-on" : ""}`, role: "radio", "aria-checked": String(method === m), disabled, onclick: () => ((method = m), renderMethods(), void run()) }, label);
    methodRow.replaceChildren(
      opt("ocr", "Bu cihazda (OCR)"),
      opt("ai", vision ? `AI (${o.ai.mode === "anthropic" ? "Claude" : "OpenAI"})` : "AI (görsel desteği yok)", !vision),
    );
  };
  renderMethods();

  const note = h("p", { class: "cm-muted", style: "margin:0;font-size:13px" });
  const setNote = () => {
    note.replaceChildren();
    if (method === "ocr") {
      note.append(math
        ? (ready(o.ai) && o.ai.mode !== "off" ? "Yazı bu cihazda tanınır, sonra metin olarak AI'ya sorulur. Görseli doğrudan okuyan AI (Claude ya da OpenAI) daha doğru sonuç verir." : "Yazı bu cihazda tanınır. Çözüm için AI gerekir: ")
        : "Tanıma bu cihazda yapılır, hiçbir şey gönderilmez. Düzgün, ayrık harflerde iyi çalışır; bitişik el yazısında AI daha iyidir. ");
      if (!vision) note.append(h("button", { class: "cm-linkbtn", style: "color:var(--accent)", onclick: () => (d.close(), o.openAiSettings()) }, "AI'yı ayarla"));
    } else {
      note.append(`Bu seçimin görseli ${o.ai.mode === "anthropic" ? "Anthropic'e" : "OpenAI'ye"} gönderilir; sayfanın geri kalanı gönderilmez.`);
    }
  };

  async function run(): Promise<void> {
    ctrl?.abort();
    const c = new AbortController();
    ctrl = c;
    setNote();
    out.value = "";
    status.textContent = "Okunuyor…";
    try {
      if (method === "ai") {
        out.value = await askSimple(o.ai, {
          system: math ? MATH_SYSTEM : TEXT_SYSTEM,
          text: math ? "Bu ifadeyi oku ve çöz." : "Bu el yazısını metne çevir.",
          image: { base64: canvasBase64(o.canvas), mediaType: "image/png" },
          signal: c.signal,
          onText: (t) => (out.value += t),
        });
      } else {
        const text = await o.ocr(o.canvas, (t) => (status.textContent = t));
        if (c.signal.aborted) return;
        if (!text.trim()) {
          status.textContent = "Yazı tanınamadı. Daha büyük ve ayrık yazmayı dene ya da AI ile oku.";
          return;
        }
        if (math && ready(o.ai) && o.ai.mode !== "off") {
          status.textContent = "Çözülüyor…";
          out.value = await askSimple(o.ai, {
            system: MATH_SYSTEM,
            text: `El yazısından bu cihazda tanınan ifade (tanıma hatalı olabilir; anlamlı en yakın ifadeyi kullan):\n${text}`,
            signal: c.signal,
            onText: (t) => (out.value += t),
          });
        } else out.value = text;
      }
      if (!c.signal.aborted) status.textContent = math ? "Çözüm hazır; kontrol etmeyi unutma." : "Metni kontrol edip düzeltebilirsin.";
    } catch (err) {
      if (c.signal.aborted) return;
      const e = await friendlyError(o.ai, err);
      status.textContent = `${e.title}. ${e.text}`;
    }
  }

  d.body.append(
    h("div", { class: "cm-hw" }, preview, methodRow, note, status, out,
      math ? null : h("label", { class: "cm-hw__check" }, removeInk, " Ekleyince el yazısını sil"),
    ),
  );
  d.foot.append(
    h("button", { class: "cm-btn cm-btn--ghost", onclick: () => o.copy(out.value) }, "Kopyala"),
    h("button", { class: "cm-btn", onclick: () => {
      if (!out.value.trim()) return;
      if (math) o.insertNote(out.value.trim());
      else o.insertText(out.value.trim(), removeInk.checked);
      d.close();
    } }, math ? "Not olarak ekle" : "Metin kutusu olarak ekle"),
  );
  const close = d.close;
  d.close = () => {
    ctrl?.abort();
    close();
  };
  void run();
}
