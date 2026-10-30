import { bytes, num } from "../format";
import { exportFileName, selectForExport, toMarkdown } from "../markdown";
import type { Color, Highlight, PdfDark, Settings, ThemeSetting, UiSize } from "../types";
import { COLORS } from "../types";
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
export function openExport(o: { title: string; fileName: string; highlights: Highlight[]; names: Record<Color, string> }): void {
  const d = openDialog({ title: "Dışa aktar", width: 880 });
  const colors = new Set<Color>(COLORS);
  let groupBy: "page" | "color" = "page";
  let onlyWithNotes = false;
  const preview = h("pre", { class: "cm-code", style: "height:400px;overflow:auto", tabindex: "0", "aria-label": "Önizleme" });
  const total = h("span", { class: "cm-num cm-muted" });
  const md = () => toMarkdown(o.highlights, { title: o.title, names: o.names, colors, groupBy, onlyWithNotes });
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
  ["Okuma", [["J / →", "Sonraki sayfa"], ["K / ←", "Önceki sayfa"], ["G", "Sayfaya git"], ["Ctrl F", "Ara"], ["F", "Odak modu"], ["[  /  ]", "Sol şerit / sağ panel"], ["Ctrl + / −", "Yakınlaştır / uzaklaştır"], ["Ctrl 0", "Genişliğe sığdır"], ["B", "Sayfaya yer imi"], ["Ctrl O", "Dosya aç"], ["Alt 1 / Alt 3", "Oku / Düzenle modu"]]],
  ["Seçim varken", [["1 – 4", "Vurgu rengi"], ["N", "Not ekle"], ["C", "Kopyala"], ["Esc", "Kapat"], ["Ctrl Z", "Silineni geri al"]]],
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
