import { bytes, num } from "../format";
import { exportFileName, selectForExport, toMarkdown } from "../markdown";
import type { AiSettings, Color, Highlight, Mark, PdfDark, Settings, ThemeSetting, UiSize } from "../types";
import { AI_PROVIDERS, aiModelLabel, COLORS, type AiProvider } from "../types";
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
  install(): void;
  installed: boolean;
  /** Firefox/Safari: son açılanlar için tarayıcıda tutulan PDF kopyaları. */
  copies: { usage(): Promise<string>; clear(): void };
  errors: { view(): void; download(): void; clear(): void };
}

/** Renk adları, tema, koyu temada PDF, arayüz yazı boyutu ve veri yedeği. */
export function openSettings(settings: Settings, a: SettingsActions): void {
  const s: Settings = { ...settings, names: { ...settings.names } };
  const copiesLine = h("div", { class: "cm-muted", style: "font-size:13px;line-height:18px" });
  void a.copies.usage().then((u) => {
    if (!u) return;
    copiesLine.replaceChildren(`Son açılanlar için saklanan: ${u} `, h("button", { class: "cm-linkbtn", onclick: () => (a.copies.clear(), copiesLine.replaceChildren()) }, "Sil"));
  });
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
        h("span", { text: s.ai.mode !== "off"
          ? `Açık · ${AI_PROVIDERS[s.ai.mode].label} · ${aiModelLabel(s.ai)}`
          : "Kapalı. Kapalıyken AI'a dair hiçbir düğme görünmez." }),
        h("button", { class: "cm-btn cm-btn--sm", onclick: () => (d.close(), a.ai()) }, s.ai.mode !== "off" ? "AI ayarları…" : "AI'yı aç…"),
      ),
    ),
    h("section", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px" },
      h("div", {}, h("p", { class: "cm-label", text: "Uygulama" }),
        h("div", { style: "display:flex;flex-direction:column;gap:8px;align-items:flex-start" },
          a.installed
            ? h("span", { text: "Uygulama olarak kurulu. İnternet olmadan da açılır." })
            : h("button", { class: "cm-btn cm-btn--sm", onclick: () => a.install() }, "Uygulama olarak kur"),
          help("Bir kez açıldıktan sonra internetsiz çalışır. Kurulunca PDF'leri bilgisayarındaki \"Birlikte aç\" menüsünden açabilirsin."),
        )),
      h("div", {}, h("p", { class: "cm-label", text: "Hata günlüğü" }),
        (() => {
          const input = h("input", { type: "checkbox", checked: s.errorLog });
          input.addEventListener("change", () => set("errorLog")(input.checked));
          return h("label", { class: "cm-field" }, input, "Hataları bu tarayıcıda kaydet");
        })(),
        help("Hiçbir yere gönderilmez. Bir sorun bildirirken indirip paylaşabilirsin; dosya adları ve PDF metni kaydedilmez."),
        h("div", { style: "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap" },
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => a.errors.view() }, "Görüntüle"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => a.errors.download() }, "İndir (.json)"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--danger", onclick: () => a.errors.clear() }, "Temizle"),
        )),
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
          copiesLine,
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
export interface PdfChoice {
  mode: "flatten" | "annotations";
  colors: Set<Color>;
  withNotes: boolean;
  withWriting: boolean;
}

/**
 * Biçim solda, canlı önizleme sağda. Markdown (varsayılan; sınav öncesi toparlamanın asıl ürünü metin)
 * ya da vurgulu / işaretli PDF.
 */
export function openExport(o: {
  title: string;
  fileName: string;
  highlights: Highlight[];
  marks: Mark[];
  names: Record<Color, string>;
  pageCount: number;
  pdf(choice: PdfChoice): Promise<void>;
  initial?: "md" | "pdf";
}): void {
  const d = openDialog({ title: "Dışa aktar", width: 880 });
  let format: "md" | "pdf" = o.initial ?? "md";
  let pdfMode: PdfChoice["mode"] = "flatten";
  const colors = new Set<Color>(COLORS);
  let groupBy: "page" | "color" = "page";
  let onlyWithNotes = false;
  let withWriting = true;
  let withNotes = true;
  const writing = o.marks.filter((m) => (m.kind === "text" || m.kind === "sticky") && m.text.trim()).length;
  const drawings = o.marks.filter((m) => m.kind === "ink" || m.kind === "shape").length;
  const preview = h("pre", { class: "cm-code", style: "height:400px;overflow:auto", tabindex: "0", "aria-label": "Önizleme" });
  const total = h("span", { class: "cm-num cm-muted" });
  const md = () => toMarkdown(o.highlights, { title: o.title, names: o.names, colors, groupBy, onlyWithNotes, marks: withWriting ? o.marks : [] });
  const update = () => {
    const n = selectForExport(o.highlights, { colors, onlyWithNotes: format === "md" && onlyWithNotes }).length;
    total.textContent = `${num(n)} vurgu`;
    if (format === "md") {
      preview.textContent = md();
      return;
    }
    const notes = o.highlights.filter((x) => colors.has(x.color) && x.note.trim()).length;
    preview.textContent = [
      `${o.fileName.replace(/\.pdf$/i, "")}-isaretli.pdf`,
      "",
      `${num(o.pageCount)} sayfa · ${num(n)} vurgu${withNotes ? ` · ${num(notes)} not (açıklama balonu)` : ""}${withWriting ? ` · ${num(drawings)} çizim · ${num(writing)} metin kutusu / not` : ""}`,
      "",
      pdfMode === "flatten"
        ? "Düzleştirilmiş: vurgular, çizimler ve metin kutuları sayfanın parçası olur; Acrobat, Preview ve tarayıcıda aynı görünür, ama sonradan tek tek düzenlenemez. Notlar standart açıklama balonu olarak eklenir."
        : "Düzenlenebilir işaretler: vurgular, çizimler ve notlar standart PDF açıklamaları olarak eklenir; başka bir okuyucuda düzenlenip silinebilir. Bazı okuyucular (özellikle tarayıcılar) bunları farklı ya da eksik gösterebilir.",
      "",
      "Orijinal dosyan değişmez; işaretli kopya ayrı bir dosya olarak indirilir.",
    ].join("\n");
  };
  const counts = new Map<Color, number>(COLORS.map((c) => [c, o.highlights.filter((x) => x.color === c).length]));
  const check = (label: Node[], on: boolean, onChange: (v: boolean) => void) => {
    const input = h("input", { type: "checkbox", checked: on });
    input.addEventListener("change", () => (onChange(input.checked), update()));
    return h("label", { class: "cm-field" }, input, ...label);
  };
  const left = h("div", { style: "display:flex;flex-direction:column;gap:16px" });
  const option = (f: "md" | "pdf", title: string, ext: string, text: string) =>
    h("button", { class: `cm-option${format === f ? " is-on" : ""}`, role: "radio", "aria-checked": String(format === f), onclick: () => ((format = f), renderLeft(), renderFoot(), update()) },
      h("span", { class: "cm-radio" }),
      h("div", {}, h("div", { style: "font-weight:600" }, `${title} `, h("span", { class: "cm-num cm-muted", text: ext })), h("div", { class: "cm-muted", style: "font-size:13px;line-height:18px", text })));
  const renderLeft = () => {
    left.replaceChildren(
      h("div", { role: "radiogroup", "aria-label": "Biçim", style: "display:flex;flex-direction:column;gap:8px" },
        option("md", "Markdown notları", ".md", "Vurgular ve notlar, sayfa numaralarıyla. Obsidian, Notion veya herhangi bir editörde açılır."),
        option("pdf", "Vurgulu PDF", ".pdf", "Orijinal dosya + vurgular, çizimler ve notlar. Notlar açıklama balonu olur."),
      ),
      h("div", {}, h("p", { class: "cm-label", text: "Dahil et" }),
        h("div", { style: "display:flex;flex-direction:column;gap:4px" }, ...COLORS.map((c) =>
          check([marker(c), document.createTextNode(o.names[c]), h("span", { class: "cm-num cm-muted", text: num(counts.get(c)!) })], colors.has(c), (v) => (v ? colors.add(c) : colors.delete(c))),
        ))),
      ...(format === "md"
        ? [
            h("div", {}, h("p", { class: "cm-label", text: "Düzen" }),
              seg("Gruplama", [["page", "Sayfaya göre"], ["color", "Renge göre"]], groupBy, (v) => ((groupBy = v), update()))),
            check([document.createTextNode("Yalnızca notu olan vurgular")], onlyWithNotes, (v) => (onlyWithNotes = v)),
            writing ? check([document.createTextNode("Metin kutuları ve yapışkan notlar "), h("span", { class: "cm-num cm-muted", text: num(writing) })], withWriting, (v) => (withWriting = v)) : h("span"),
          ]
        : [
            h("div", {}, h("p", { class: "cm-label", text: "İşaretler" }),
              seg("PDF işaretleri", [["flatten", "Düzleştir"], ["annotations", "Düzenlenebilir"]], pdfMode, (v) => ((pdfMode = v), update()))),
            check([document.createTextNode("Vurgu notları (açıklama balonu)")], withNotes, (v) => (withNotes = v)),
            writing + drawings ? check([document.createTextNode("Yaz modu işaretleri "), h("span", { class: "cm-num cm-muted", text: num(writing + drawings) })], withWriting, (v) => (withWriting = v)) : h("span"),
          ]),
    );
  };
  renderLeft();
  d.body.style.cssText = "display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:24px";
  d.body.append(left, h("div", { style: "display:flex;flex-direction:column;gap:8px;min-width:0" },
    h("div", { style: "display:flex;justify-content:space-between" }, h("p", { class: "cm-label", style: "margin:0", text: "Önizleme" }), total),
    preview,
  ));
  const actions = h("div", { style: "display:flex;gap:8px" });
  const renderFoot = () => {
    if (format === "md") {
      actions.replaceChildren(
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
      );
    } else {
      const btn = h("button", { class: "cm-btn cm-btn--primary", onclick: async () => {
        btn.disabled = true;
        btn.textContent = "Hazırlanıyor…";
        try {
          await o.pdf({ mode: pdfMode, colors: new Set(colors), withNotes, withWriting });
          d.close();
        } catch (err) {
          btn.disabled = false;
          btn.replaceChildren("İndir ", h("span", { class: "cm-num", text: ".pdf" }));
          const encrypted = err instanceof Error && /encrypt/i.test(err.message);
          toast(encrypted ? "Parola korumalı PDF'e işaret eklenemiyor. Parolasız bir kopyayla dene." : "İşaretli PDF oluşturulamadı. Yeniden dene.", undefined, 6000);
        }
      } }, "İndir ", h("span", { class: "cm-num", text: ".pdf" }));
      actions.replaceChildren(btn);
    }
  };
  renderFoot();
  d.foot.append(h("span", { class: "cm-trust", text: "Dosya bu cihazda oluşturulur, hiçbir yere gönderilmez." }), actions);
  update();
}

// ---------- Kısayollar ----------

const SHORTCUTS: [string, [string, string][]][] = [
  ["Okuma", [["J / →", "Sonraki sayfa"], ["K / ←", "Önceki sayfa"], ["G", "Sayfaya git"], ["Ctrl F", "Ara"], ["F", "Odak modu"], ["[  /  ]", "Sol şerit / sağ panel"], ["Ctrl + / −", "Yakınlaştır / uzaklaştır"], ["Ctrl 0", "Genişliğe sığdır"], ["B", "Sayfaya yer imi"], ["Shift N", "Sayfa notu"], ["Ctrl O", "Dosya aç"], ["Alt 1 / Alt 2 / Alt 3", "Oku / Yaz / Düzenle modu"], ["Ctrl J", "AI paneli (AI açıksa)"], ["Alt T", "Tekrar modu"]]],
  ["Seçim varken", [["1 – 4", "Vurgu rengi"], ["N", "Not ekle"], ["C", "Kopyala"], ["A", "AI'ya sor (AI açıksa)"], ["Esc", "Kapat"], ["Ctrl Z", "Silineni geri al"]]],
  ["Tekrar modu", [["Space", "Cevabı göster"], ["1 / 2 / 3", "Bilemedim / Zorlandım / Bildim"], ["G", "Kaynak sayfaya git"], ["E", "Kartı düzenle"], ["Esc", "Belgeye dön"]]],
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
 * Bulut seçeneklerinde arada bizim sunucumuz yok; istek tarayıcıdan doğrudan sağlayıcıya gider.
 */
export function openAiSetup(current: AiSettings, save: (ai: AiSettings) => void, webgpu: Promise<{ ok: boolean; reason?: string }>): void {
  const ai: AiSettings = structuredClone(current);
  if (ai.mode === "off") ai.mode = "off";
  const d = openDialog({ title: "AI'yı nasıl çalıştıralım?", width: 860 });
  const err = h("p", { role: "alert", style: "margin:4px 0 0;color:var(--danger);font-size:13px;line-height:18px", hidden: true });
  const small = (text: string) => h("p", { class: "cm-muted", style: "margin:0;font-size:12px;line-height:16px", text });
  const label = (text: string) => h("label", { class: "cm-muted", style: "font-size:12px;line-height:16px", text });
  let gpu: { ok: boolean; reason?: string } | null = null;

  // Her seçeneğin alanları: anahtar, model, adres.
  const keyInput = (p: "anthropic" | "openai", placeholder: string) => {
    const el = h("input", { class: "cm-input", type: "password", autocomplete: "off", spellcheck: "false", placeholder, "aria-label": `${AI_PROVIDERS[p].label} API anahtarı`, value: ai.keys[p] });
    el.addEventListener("input", () => (ai.keys[p] = el.value.trim()));
    return el;
  };
  const modelInput = (p: AiProvider, free: boolean) => {
    if (!free) {
      const sel = h("select", { class: "cm-input", "aria-label": "Model" }, ...AI_PROVIDERS[p].models.map(([id, l]) => h("option", { value: id, text: l, selected: id === ai.models[p] })));
      sel.addEventListener("change", () => (ai.models[p] = sel.value));
      return sel;
    }
    const listId = `models-${p}`;
    const el = h("input", { class: "cm-input", "aria-label": "Model adı", value: ai.models[p], list: listId, spellcheck: "false" });
    el.addEventListener("input", () => (ai.models[p] = el.value.trim()));
    return h("div", {}, el, h("datalist", { id: listId }, ...AI_PROVIDERS[p].models.map(([id]) => h("option", { value: id }))));
  };
  const urlInput = () => {
    const el = h("input", { class: "cm-input", "aria-label": "Sunucu adresi", value: ai.localUrl, spellcheck: "false" });
    el.addEventListener("input", () => (ai.localUrl = el.value.trim()));
    return el;
  };
  const fields: Record<AiProvider, () => HTMLElement> = {
    anthropic: () => h("div", { class: "cm-ai-fields" },
      label("Anthropic API anahtarı"), keyInput("anthropic", "sk-ant-…"), label("Model"), modelInput("anthropic", false),
      small("Düşük harcama sınırlı bir anahtar kullanman iyi olur. Anahtar yalnızca bu tarayıcıda saklanır, yedeğe girmez.")),
    openai: () => h("div", { class: "cm-ai-fields" },
      label("OpenAI API anahtarı"), keyInput("openai", "sk-…"), label("Model"), modelInput("openai", true),
      small("Model adını OpenAI hesabında kullanabildiğin modellerden yaz. Ücret gösterilmez; harcamayı OpenAI panelinden izle.")),
    local: () => h("div", { class: "cm-ai-fields" },
      label("Sunucu adresi (OpenAI uyumlu)"), urlInput(), label("Model"), modelInput("local", true),
      small("Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1. Tarayıcının erişebilmesi için sunucuda CORS izni gerekir (Ollama'da OLLAMA_ORIGINS ortam değişkeni). Metin bilgisayarından çıkmaz.")),
    device: () => {
      const box = h("div", { class: "cm-ai-fields" }, label("Model"), modelInput("device", false),
        small("Model ilk soruda bir kez indirilir (1–2 GB) ve bu tarayıcıda kalır; indirme sırasında okumaya devam edebilirsin. Kısa açıklama ve basitleştirmede iyi, uzun özette zayıf; telefonda önerilmez."));
      if (gpu && !gpu.ok) box.append(h("p", { class: "cm-ai__err", style: "margin:0;font-size:13px", text: gpu.reason ?? "" }));
      return box;
    },
  };
  const option = (mode: AiSettings["mode"], title: string, text: string, disabled = false) =>
    h("button", { class: `cm-option${ai.mode === mode ? " is-on" : ""}`, role: "radio", "aria-checked": String(ai.mode === mode), disabled, onclick: () => {
      ai.mode = mode;
      err.hidden = true;
      render();
    } }, h("span", { class: "cm-radio" }), h("div", {}, h("div", { style: "font-weight:600", text: title }), h("div", { class: "cm-muted", style: "font-size:13px;line-height:18px", text })));
  const choices = h("div", { role: "radiogroup", "aria-label": "AI çalışma yeri", style: "display:flex;flex-direction:column;gap:8px" });
  const render = () => {
    const opts: [AiSettings["mode"], string, string, boolean?][] = [
      ["device", "Bu cihazda", gpu && !gpu.ok ? `Bu tarayıcıda kullanılamaz: ${gpu.reason}` : "Metin tarayıcıdan hiç çıkmaz. WebGPU ister; daha yavaş.", gpu ? !gpu.ok : false],
      ["local", "Bilgisayarımdaki model", "Ollama ya da LM Studio gibi yerel bir sunucu. Metin bilgisayarından çıkmaz."],
      ["anthropic", "Kendi Anthropic anahtarınla (Claude)", "Seçtiğin metin tarayıcından doğrudan Anthropic'e gider; arada bizim sunucumuz yok. Hızlı ve güçlü."],
      ["openai", "Kendi OpenAI anahtarınla", "Seçtiğin metin tarayıcından doğrudan OpenAI'ye gider; arada bizim sunucumuz yok."],
      ["off", "Kapalı", "AI düğmeleri gizlenir. İstediğin zaman Ayarlar'dan açabilirsin."],
    ];
    choices.replaceChildren(...opts.flatMap(([mode, title, text, disabled]) => [
      option(mode, title, text, disabled),
      ...(ai.mode === mode && mode !== "off" ? [fields[mode as AiProvider]()] : []),
    ]), err);
  };
  render();
  void webgpu.then((g) => {
    gpu = g;
    if (!g.ok && ai.mode === "device") ai.mode = current.mode;
    render();
  });
  d.body.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,260px);gap:24px";
  d.body.append(
    choices,
    h("div", { style: "border-left:1px solid var(--line);padding-left:24px" },
      h("p", { class: "cm-label", text: "Ne gönderilir" }),
      h("ul", { style: "margin:0 0 16px;padding-left:18px;display:flex;flex-direction:column;gap:6px" },
        h("li", { text: "Yalnızca seçtiğin kapsam: seçim, sayfa, bölüm ya da vurguların" }),
        h("li", { text: "Gönderilecek karakter sayısı her istekte görünür; göndermeden kırpabilirsin" }),
        h("li", { text: "Cihazda ve yerel sunucuda: hiçbir şey internete gitmez" }),
      ),
      h("p", { class: "cm-label", text: "Asla gönderilmez" }),
      h("ul", { style: "margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px" },
        h("li", { text: "Dosyanın tamamı, kendiliğinden" }),
        h("li", { text: "Arka planda hiçbir istek: AI yalnızca sen sorunca çalışır" }),
        h("li", { text: "Dosya adı ve diğer dosyaların" }),
      ),
    ),
  );
  const hasKeys = !!(current.keys.anthropic || current.keys.openai);
  d.foot.append(
    h("span", { class: "cm-trust", text: "Seçimin ve anahtarların bu tarayıcıda saklanır." }),
    h("div", { style: "display:flex;gap:8px" },
      hasKeys ? h("button", { class: "cm-btn cm-btn--ghost cm-btn--danger", onclick: () => {
        save({ ...current, keys: { anthropic: "", openai: "" }, mode: current.mode === "anthropic" || current.mode === "openai" ? "off" : current.mode });
        toast("API anahtarları silindi");
        d.close();
      } }, "Anahtarları sil") : h("span"),
      h("button", { class: "cm-btn", onclick: d.close }, "Şimdi değil"),
      h("button", { class: "cm-btn cm-btn--primary", onclick: () => {
        const fail = (msg: string) => {
          err.hidden = false;
          err.textContent = msg;
        };
        if (ai.mode === "anthropic" && !/^sk-ant-/.test(ai.keys.anthropic)) return fail("Bu bir Anthropic API anahtarına benzemiyor. Anahtarlar sk-ant- ile başlar; console.anthropic.com'dan alabilirsin.");
        if (ai.mode === "openai" && !/^sk-/.test(ai.keys.openai)) return fail("Bu bir OpenAI API anahtarına benzemiyor. Anahtarlar sk- ile başlar; platform.openai.com'dan alabilirsin.");
        if (ai.mode === "local" && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(ai.localUrl)) return fail("Yerel sunucu adresi http://localhost:PORT/v1 biçiminde olmalı. Güvenlik için yalnızca bu bilgisayardaki sunuculara bağlanılır.");
        if (ai.mode !== "off" && !ai.models[ai.mode]) return fail("Model adını yaz.");
        save(ai);
        toast(ai.mode !== "off" ? "AI açıldı · Ctrl J ile paneli aç" : "AI kapalı");
        d.close();
      } }, "Kaydet"),
    ),
  );
}
