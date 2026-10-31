import { openDialog } from "../ui/dialog";
import { h } from "../util";
import { QTYPES, type QType, type QuizRequest } from "./quiz";

export type QuizScope = { kind: "all" } | { kind: "page" } | { kind: "range"; from: number; to: number } | { kind: "highlights" };

/** Quiz biçimi: soru tipleri, sayı, zorluk, kapsam ve serbest ek istek. */
export function askQuiz(o: { pageCount: number; current: number; highlights: number; last?: QuizRequest }): Promise<{ req: QuizRequest; scope: QuizScope } | null> {
  return new Promise((resolve) => {
    let done = false;
    const d = openDialog({ title: "AI ile quiz oluştur", width: 600, onClose: () => !done && resolve(null) });
    const types = new Set<QType>(o.last?.types ?? ["mc", "tf"]);
    let count = o.last?.count ?? 10;
    let level: QuizRequest["level"] = o.last?.level ?? "orta";
    let scope: QuizScope["kind"] = o.pageCount > 1 ? "all" : "page";
    const from = h("input", { class: "cm-input cm-num", type: "number", min: "1", max: String(o.pageCount), value: "1", "aria-label": "İlk sayfa", style: "width:80px" });
    const to = h("input", { class: "cm-input cm-num", type: "number", min: "1", max: String(o.pageCount), value: String(o.pageCount), "aria-label": "Son sayfa", style: "width:80px" });
    const extra = h("textarea", { class: "cm-input", rows: 3, placeholder: "örn. vize formatında, her soru 10 puan · tanımlara ağırlık ver · İngilizce sorular", "aria-label": "Ek istek" });
    extra.value = o.last?.extra ?? "";
    const err = h("p", { class: "cm-field-error", role: "alert" });

    const chips = h("div", { class: "cm-form__chips", role: "group", "aria-label": "Soru tipleri" });
    const renderTypes = () => chips.replaceChildren(...QTYPES.map(([t, l]) =>
      h("button", { type: "button", class: `cm-chip${types.has(t) ? " is-on" : ""}`, "aria-pressed": String(types.has(t)), onclick: () => (types.has(t) ? types.delete(t) : types.add(t), renderTypes()) }, l)));
    renderTypes();
    const seg = <T,>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void, after?: () => void) => {
      const el = h("div", { class: "cm-seg cm-seg--sm", role: "radiogroup", "aria-label": label });
      const render = () => el.replaceChildren(...opts.map(([v, l]) => h("button", { type: "button", role: "radio", "aria-checked": String(get() === v), class: get() === v ? "is-on" : "", onclick: () => (set(v), render(), after?.()) }, l)));
      render();
      return el;
    };
    const range = h("div", { style: "display:flex;gap:8px;align-items:center", hidden: true }, "Sayfa", from, "–", to);
    const scopes: [QuizScope["kind"], string][] = [["all", "Tüm belge"], ["page", `Bu sayfa (${o.current + 1})`], ["range", "Sayfa aralığı"], ...(o.highlights ? [["highlights", `Vurgularım (${o.highlights})`] as [QuizScope["kind"], string]] : [])];
    d.body.append(h("div", { class: "cm-form" },
      h("label", { class: "cm-label", text: "Soru tipleri (birden çok seçebilirsin)" }), chips,
      h("label", { class: "cm-label", text: "Soru sayısı" }), seg("Soru sayısı", [[5, "5"], [10, "10"], [15, "15"], [20, "20"]], () => count, (v) => (count = v)),
      h("label", { class: "cm-label", text: "Zorluk" }), seg<QuizRequest["level"]>("Zorluk", [["kolay", "Kolay"], ["orta", "Orta"], ["zor", "Zor"], ["karışık", "Karışık"]], () => level, (v) => (level = v)),
      h("label", { class: "cm-label", text: "Kapsam" }), seg("Kapsam", scopes, () => scope, (v) => (scope = v), () => (range.hidden = scope !== "range")), range,
      h("label", { class: "cm-label", text: "Ek istek (isteğe bağlı)" }), extra,
      h("p", { class: "cm-muted", style: "margin:0;font-size:12px", text: "Seçtiğin kapsamın metni AI sağlayıcına gider. Uzun belgede metin sayfalara dengeli dağıtılarak kısaltılır." }),
      err,
    ));
    d.foot.append(
      h("button", { class: "cm-btn cm-btn--ghost", onclick: () => d.close() }, "Vazgeç"),
      h("button", { class: "cm-btn cm-btn--primary", onclick: () => {
        if (!types.size) return void (err.textContent = "En az bir soru tipi seç.");
        const a = Math.max(1, Math.min(o.pageCount, Number(from.value) || 1));
        const b = Math.max(a, Math.min(o.pageCount, Number(to.value) || o.pageCount));
        done = true;
        d.close();
        resolve({
          req: { types: [...types], count, level, extra: extra.value },
          scope: scope === "range" ? { kind: "range", from: a - 1, to: b - 1 } : scope === "all" ? { kind: "all" } : scope === "page" ? { kind: "page" } : { kind: "highlights" },
        });
      } }, "Oluştur"),
    );
  });
}
