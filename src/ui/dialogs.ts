import { bytes, num } from "../format";
import { exportFileName, selectForExport, toMarkdown } from "../markdown";
import type { AiSettings, Color, Highlight, Mark, PdfDark, Settings, ThemeSetting, UiSize } from "../types";
import { AI_MODELS, COLORS } from "../types";
import { download, h, kbd, marker } from "../util";
import { confirmDialog, openDialog } from "./dialog";
import { toast } from "./toast";

function seg<T extends string>(label: string, options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const group = h("div", { class: "cm-seg", role: "group", "aria-label": label });
  const render = (v: T) => {
    group.replaceChildren(...options.map(([val, text]) =>
      h("button", { class: val === v ? "is-on" : "", "aria-pressed": String(val === v), onclick: () => (render(val), onChange(val)) }, text),
    ));
  };
  render(value);
  return group;
}

// ---------- Ayarlar ----------

export interface SettingsActions {
  change(s: Settings): void;
  counts(): Record<Color, number>;
  backup(): void;
  restore(): void;
  wipe(): void;
  shortcuts(): void;
  ai(): void;
}

/** Renk adları, tema, koyu temada PDF, arayüz yazı boyutu ve veri yedeği. */
export function openSettings(settings: Settings, a: SettingsActions): void {
  const s: Settings = { ...settings, names: { ...settings.names } };
  const d = openDialog({ title: "Ayarlar", width: 760 });
  const counts = a.counts();
  const rows = COLORS.map((c) => {
    const input = h("input", { class: "cm-input", value: s.names[c], "aria-label": `Renk ${c} adı`, maxlength: 32 });
    input.addEventListener("input", () => {
      // Ad değişikliği anında panelde, ipuçlarında ve dışa aktarmada yansır.
      s.names[c] = input.value.trim() || settings.names[c];
      a.change({ ...s, names: { ...s.names } });
    });
    return h("div", { style: "display:grid;grid-template-columns:32px 28px 1fr 96px;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)" },
      h("span", { class: `cm-float__sw cm-float__sw--${c}`, style: "cursor:default" }, marker(c)),
      kbd(String(c)),
      input,
      h("span", { class: "cm-num cm-muted", style: "text-align:right", text: `${num(counts[c])} vurgu` }),
    );
  });
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => {
    s[k] = v;
    a.change({ ...s, names: { ...s.names } });
  };
  const help = (text: string) => h("p", { class: "cm-muted", style: "margin:6px 0 0;font-size:13px;line-height:18px", text });
  d.body.style.cssText = "display:flex;flex-direction:column;gap:28px";
  d.body.append(
    h("section", {},
      h("p", { class: "cm-label", text: "Vurgu renkleri" }),
      h("p", { class: "cm-muted", style: "margin:0 0 8px", text: "Renkler sabit; kontrastı ve renk körlüğü için şekilleri korunur. Adları senin." }),
      ...rows,
      help("Bir adı değiştirmek mevcut vurguları değiştirmez, yalnızca etiketlerini günceller."),
    ),
    h("section", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px" },
      h("div", {}, h("p", { class: "cm-label", text: "Tema" }),
        seg<ThemeSetting>("Tema", [["light", "Açık"], ["dark", "Koyu"], ["system", "Sistem"]], s.theme, set("theme"))),
      h("div", {}, h("p", { class: "cm-label", text: "Koyu temada PDF" }),
        seg<PdfDark>("Koyu temada PDF", [["soften", "Yumuşat"], ["original", "Orijinal"]], s.pdfDark, set("pdfDark")),
        help("Yumuşat: sayfa parlaklığı %85, hafif sıcak ton. Grafik ve fotoğraflar bozulmaz.")),
    ),
    h("section", {},
      h("p", { class: "cm-label", text: "AI" }),
      h("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" },
        h("span", { text: s.ai.mode === "cloud"
          ? `Açık · kendi API anahtarınla · ${AI_MODELS.find(([id]) => id === s.ai.model)?.[1] ?? s.ai.model}`
          : "Kapalı. Kapalıyken AI'a dair hiçbir düğme görünmez." }),
        h("button", { class: "cm-btn cm-btn--sm", onclick: () => (d.close(), a.ai()) }, s.ai.mode === "cloud" ? "AI ayarları…" : "AI'yı aç…"),
      ),
    ),
    h("section", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px" },
      h("div", {}, h("p", { class: "cm-label", text: "Arayüz yazı boyutu" }),
        seg<UiSize>("Yazı boyutu", [["small", "Küçük"], ["normal", "Normal"], ["large", "Büyük"]], s.uiSize, set("uiSize")),
        help("Panel ve notları etkiler. PDF boyutu zoom ile değişir.")),
      h("div", {}, h("p", { class: "cm-label", text: "Verilerin" }),
        h("div", { style: "display:flex;flex-direction:column;gap:8px;align-items:flex-start" },
          h("button", { class: "cm-btn cm-btn--sm", onclick: a.backup }, "Tüm vurguları yedekle (.json)"),
          h("button", { class: "cm-btn cm-btn--sm", onclick: a.restore }, "Yedekten geri yükle"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--danger", onclick: () => (d.close(), a.wipe()) }, "Bu tarayıcıdaki tüm verileri sil…"),
        )),
    ),
  );
  d.foot.append(
    h("span", { class: "cm-trust", text: "Ayarlar bu tarayıcıda saklanır." }),
    h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => (d.close(), a.shortcuts()) }, "Kısayollar ", kbd("?")),
  );
}

// ---------- Dışa aktar ----------

/** Biçim solda, canlı önizleme sağda. İlk sürümde yalnızca Markdown. */
export function openExport(o: { title: string; fileName: string; highlights: Highlight[]; marks: Mark[]; names: Record<Color, string> }): void {
  const d = openDialog({ title: "Dışa aktar", width: 880 });
  const colors = new Set<Color>(COLORS);
  let groupBy: "page" | "color" = "page";
  let onlyWithNotes = false;
  let withWriting = true;
  const writing = o.marks.filter((m) => (m.kind === "text" || m.kind === "sticky") && m.text.trim()).length;
  const preview = h("pre", { class: "cm-code", style: "height:400px;overflow:auto", tabindex: "0", "aria-label": "Önizleme" });
  const total = h("span", { class: "cm-num cm-muted" });
  const md = () => toMarkdown(o.highlights, { title: o.title, names: o.names, colors, groupBy, onlyWithNotes, marks: withWriting ? o.marks : [] });
  const update = () => {
    preview.textContent = md();
    total.textContent = `${num(selectForExport(o.highlights, { colors, onlyWithNotes }).length)} vurgu`;
  };
  const counts = new Map<Color, number>(COLORS.map((c) => [c, o.highlights.filter((x) => x.color === c).length]));
  const check = (label: Node[], on: boolean, onChange: (v: boolean) => void) => {
    const input = h("input", { type: "checkbox", checked: on });
    input.addEventListener("change", () => (onChange(input.checked), update()));
    return h("label", { class: "cm-field" }, input, ...label);
  };
  d.body.style.cssText = "display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:24px";
  d.body.append(
    h("div", { style: "display:flex;flex-direction:column;gap:16px" },
      h("div", { class: "cm-option is-on", role: "radio", "aria-checked": "true", tabindex: "0" },
        h("span", { class: "cm-radio" }),
        h("div", {},
          h("div", { style: "font-weight:600" }, "Markdown notları ", h("span", { class: "cm-num cm-muted", text: ".md" })),
          h("div", { class: "cm-muted", style: "font-size:13px;line-height:18px", text: "Vurgular ve notlar, sayfa numaralarıyla. Obsidian, Notion veya herhangi bir editörde açılır." }),
        ),
      ),
      h("div", {}, h("p", { class: "cm-label", text: "Dahil et" }),
        h("div", { style: "display:flex;flex-direction:column;gap:4px" }, ...COLORS.map((c) =>
          check([marker(c), document.createTextNode(o.names[c]), h("span", { class: "cm-num cm-muted", text: num(counts.get(c)!) })], true, (v) => (v ? colors.add(c) : colors.delete(c))),
        ))),
      h("div", {}, h("p", { class: "cm-label", text: "Düzen" }),
        seg("Gruplama", [["page", "Sayfaya göre"], ["color", "Renge göre"]], groupBy, (v) => ((groupBy = v), update()))),
      check([document.createTextNode("Yalnızca notu olan vurgular")], false, (v) => (onlyWithNotes = v)),
      writing ? check([document.createTextNode("Metin kutuları ve yapışkan notlar "), h("span", { class: "cm-num cm-muted", text: num(writing) })], true, (v) => (withWriting = v)) : h("span"),
    ),
    h("div", { style: "display:flex;flex-direction:column;gap:8px;min-width:0" },
      h("div", { style: "display:flex;justify-content:space-between" }, h("p", { class: "cm-label", style: "margin:0", text: "Önizleme" }), total),
      preview,
    ),
  );
  d.foot.append(
    h("span", { class: "cm-trust", text: "Dosya bu cihazda oluşturulur, hiçbir yere gönderilmez." }),
    h("div", { style: "display:flex;gap:8px" },
      h("button", { class: "cm-btn", onclick: async () => {
        try {
          await navigator.clipboard.writeText(md());
          toast("Panoya kopyalandı");
        } catch {
          toast("Panoya kopyalanamadı. İndir düğmesini kullan.");
        }
      } }, "Panoya kopyala"),
      h("button", { class: "cm-btn cm-btn--primary", autofocus: true, onclick: () => {
        download(exportFileName(o.fileName), md(), "text/markdown;charset=utf-8");
        d.close();
      } }, "İndir ", h("span", { class: "cm-num", text: ".md" })),
    ),
  );
  update();
}

// ---------- Kısayollar ----------

const SHORTCUTS: [string, [string, string][]][] = [
  ["Okuma", [["J / →", "Sonraki sayfa"], ["K / ←", "Önceki sayfa"], ["G", "Sayfaya git"], ["Ctrl F", "Ara"], ["F", "Odak modu"], ["[  /  ]", "Sol şerit / sağ panel"], ["Ctrl + / −", "Yakınlaştır / uzaklaştır"], ["Ctrl 0", "Genişliğe sığdır"], ["B", "Sayfaya yer imi"], ["Ctrl O", "Dosya aç"], ["Alt 1 / Alt 2 / Alt 3", "Oku / Yaz / Düzenle modu"], ["Ctrl J", "AI paneli (AI açıksa)"]]],
  ["Seçim varken", [["1 – 4", "Vurgu rengi"], ["N", "Not ekle"], ["C", "Kopyala"], ["A", "AI'ya sor (AI açıksa)"], ["Esc", "Kapat"], ["Ctrl Z", "Silineni geri al"]]],
  ["Yaz modu", [["V", "Seç"], ["H", "Vurgu"], ["P", "Kalem"], ["T", "Metin kutusu"], ["S", "Yapışkan not"], ["R", "Şekil"], ["E", "Silgi"], ["Shift 1 – 3", "Kalem rengi"], ["Ctrl Z / Ctrl Shift Z", "Geri al / yinele"], ["Del", "Seçili işareti sil"], ["Esc", "Oku moduna dön"]]],
  ["İşaretler paneli", [["J / K", "Satır gez"], ["Enter", "Vurguya atla"], ["E", "Notu düzenle"], ["Delete", "Sil"], ["Ctrl Enter", "Notu kapat"]]],
  ["Düzenle modu", [["Oklar", "Gez"], ["Space", "Seç"], ["Shift + ok", "Aralık seç"], ["Ctrl ↑ / ↓", "Seçileni taşı"], ["R", "Döndür"], ["Ctrl D", "Çoğalt"], ["Del", "Sil"], ["Ctrl Z", "Geri al"]]],
];

export function openShortcuts(): void {
  const d = openDialog({ title: "Kısayollar", width: 720 });
  d.body.append(
    h("div", { class: "cm-shortcuts" }, ...SHORTCUTS.map(([title, list]) =>
      h("section", {}, h("p", { class: "cm-label", text: title }),
        h("dl", {}, ...list.flatMap(([k, v]) => [h("dt", {}, ...k.split(" / ").flatMap((x, i) => (i ? [" / ", kbd(x)] : [kbd(x)]))), h("dd", { text: v })])),
      ),
    )),
  );
  d.foot.append(h("span", { class: "cm-muted", text: "Tek harfli kısayollar bir girdi alanı odaktayken çalışmaz." }));
}

// ---------- Parola ----------

/** Parola yalnızca bu açılış için kullanılır, kaydedilmez. */
export function askPassword(fileName: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const d = openDialog({ title: "Bu dosya parola korumalı", onClose: () => resolve(result) });
    const input = h("input", { class: "cm-input", type: "password", "aria-label": "Parola", autocomplete: "off", autofocus: true });
    if (wrong) input.style.borderColor = "var(--danger)";
    const submit = () => {
      result = input.value;
      d.close();
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    d.body.append(
      h("p", { style: "margin:0 0 12px" }, `„${fileName}" dosyasını açmak için parolayı gir. Parola yalnızca bu açılış için kullanılır, kaydedilmez.`),
      input,
    );
    if (wrong) d.body.append(h("p", { style: "margin:6px 0 0;color:var(--danger);font-size:13px;line-height:18px", role: "alert", text: "Parola yanlış. Büyük/küçük harfe dikkat et." }));
    d.foot.append(h("span"), h("div", { style: "display:flex;gap:8px" },
      h("button", { class: "cm-btn", onclick: d.close }, "Vazgeç"),
      h("button", { class: "cm-btn cm-btn--primary", onclick: submit }, "Aç"),
    ));
  });
}

// ---------- Büyük dosya ----------

export const BIG_BYTES = 300 * 1024 * 1024;
export const BIG_PAGES = 1500;

/** Açmadan önce sorulur, çünkü sekme çöktükten sonra uyarmanın anlamı yok. */
export function confirmBigFile(name: string, size: number, pages?: number): Promise<boolean> {
  const text = h("div", {},
    h("p", { style: "margin:0 0 8px" }, `„${name}" `, h("span", { class: "cm-num", text: bytes(size) }),
      pages ? ", " : "", pages ? h("span", { class: "cm-num", text: num(pages) }) : "", pages ? " sayfa" : "",
      ". Tarayıcı yavaşlayabilir ya da sekme kapanabilir."),
    h("p", { class: "cm-muted", style: "margin:0", text: "Yalnızca çalışacağın bölümü ayrı bir PDF olarak kaydedip açman daha güvenli." }),
  );
  return confirmDialog({ title: "Bu dosya çok büyük", text, ok: "Yine de aç" });
}

// ---------- AI ----------

/**
 * AI'nın nerede çalışacağı. İlk açılışta bir kez sorulur, Ayarlar > AI'dan değişir.
 * Bu sürümde: kendi API anahtarınla ya da kapalı. Arada bizim sunucumuz yok.
 */
export function openAiSetup(current: AiSettings, save: (ai: AiSettings) => void): void {
  const ai: AiSettings = { ...current };
  const d = openDialog({ title: "AI'yı nasıl çalıştıralım?", width: 820 });
  const key = h("input", { class: "cm-input", type: "password", autocomplete: "off", spellcheck: "false", placeholder: "sk-ant-…", "aria-label": "Anthropic API anahtarı", value: ai.apiKey });
  const model = h("select", { class: "cm-input", "aria-label": "Model" }, ...AI_MODELS.map(([id, label]) => h("option", { value: id, text: label, selected: id === ai.model })));
  const err = h("p", { role: "alert", style: "margin:4px 0 0;color:var(--danger);font-size:13px;line-height:18px", hidden: true });
  const fields = h("div", { style: "display:flex;flex-direction:column;gap:8px;margin:4px 0 0 28px" },
    h("label", { class: "cm-muted", style: "font-size:12px;line-height:16px", text: "Anthropic API anahtarı" }), key,
    h("label", { class: "cm-muted", style: "font-size:12px;line-height:16px", text: "Model" }), model,
    h("p", { class: "cm-muted", style: "margin:0;font-size:12px;line-height:16px", text: "Düşük harcama sınırlı bir anahtar kullanman iyi olur. Anahtar yalnızca bu tarayıcıda saklanır, yedeğe girmez." }),
    err,
  );
  const option = (mode: AiSettings["mode"], title: string, text: string) => {
    const el = h("button", { class: `cm-option${ai.mode === mode ? " is-on" : ""}`, role: "radio", "aria-checked": String(ai.mode === mode), onclick: () => {
      ai.mode = mode;
      render();
    } }, h("span", { class: "cm-radio" }), h("div", {}, h("div", { style: "font-weight:600", text: title }), h("div", { class: "cm-muted", style: "font-size:13px;line-height:18px", text })));
    return el;
  };
  const choices = h("div", { role: "radiogroup", "aria-label": "AI çalışma yeri", style: "display:flex;flex-direction:column;gap:8px" });
  const render = () => {
    choices.replaceChildren(
      option("cloud", "Kendi API anahtarınla", "Seçtiğin metin tarayıcından doğrudan Anthropic'e (Claude) gider; arada bizim sunucumuz yok. Hızlı ve güçlü. Ücret ve veri politikası sağlayıcının."),
      ...(ai.mode === "cloud" ? [fields] : []),
      option("off", "Kapalı", "AI düğmeleri gizlenir. İstediğin zaman Ayarlar'dan açabilirsin."),
    );
  };
  render();
  d.body.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,280px);gap:24px";
  d.body.append(
    choices,
    h("div", { style: "border-left:1px solid var(--line);padding-left:24px" },
      h("p", { class: "cm-label", text: "Ne gönderilir" }),
      h("ul", { style: "margin:0 0 16px;padding-left:18px;display:flex;flex-direction:column;gap:6px" },
        h("li", { text: "Yalnızca seçtiğin kapsam: seçim, sayfa, bölüm ya da vurguların" }),
        h("li", { text: "Gönderilecek karakter sayısı her istekte görünür; göndermeden kırpabilirsin" }),
      ),
      h("p", { class: "cm-label", text: "Asla gönderilmez" }),
      h("ul", { style: "margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px" },
        h("li", { text: "Dosyanın tamamı, kendiliğinden" }),
        h("li", { text: "Arka planda hiçbir istek: AI yalnızca sen sorunca çalışır" }),
        h("li", { text: "Dosya adı ve diğer dosyaların" }),
      ),
    ),
  );
  d.foot.append(
    h("span", { class: "cm-trust", text: "Seçimin ve anahtarın bu tarayıcıda saklanır." }),
    h("div", { style: "display:flex;gap:8px" },
      current.apiKey ? h("button", { class: "cm-btn cm-btn--ghost cm-btn--danger", onclick: () => {
        save({ ...current, apiKey: "", mode: "off" });
        toast("API anahtarı silindi, AI kapatıldı");
        d.close();
      } }, "Anahtarı sil") : h("span"),
      h("button", { class: "cm-btn", onclick: d.close }, "Şimdi değil"),
      h("button", { class: "cm-btn cm-btn--primary", onclick: () => {
        ai.apiKey = key.value.trim();
        ai.model = model.value;
        if (ai.mode === "cloud" && !/^sk-ant-/.test(ai.apiKey)) {
          err.hidden = false;
          err.textContent = "Bu bir Anthropic API anahtarına benzemiyor. Anahtarlar sk-ant- ile başlar; console.anthropic.com'dan alabilirsin.";
          key.focus();
          return;
        }
        save(ai);
        toast(ai.mode === "cloud" ? "AI açıldı · Ctrl J ile paneli aç" : "AI kapalı");
        d.close();
      } }, "Kaydet"),
    ),
  );
}
