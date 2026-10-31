import { TEMPLATES, type Template } from "../editor/templates";
import { h } from "../util";
import { openDialog } from "./dialog";

// Son açılanları düzenleme pencereleri: klasör, etiket, kapak rengi, kilit PIN'i, yeni not defteri.

function form(title: string, body: (HTMLElement | null)[], ok: string, read: () => unknown): Promise<unknown | null> {
  return new Promise((resolve) => {
    let done = false;
    const d = openDialog({ title, width: 460, onClose: () => !done && resolve(null) });
    const f = h("form", { class: "cm-form" }, ...body);
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = read();
      if (v === undefined) return;
      done = true;
      d.close();
      resolve(v);
    });
    d.body.append(f);
    d.foot.append(
      h("button", { class: "cm-btn cm-btn--ghost", type: "button", onclick: () => d.close() }, "Vazgeç"),
      h("button", { class: "cm-btn cm-btn--primary", onclick: () => f.requestSubmit() }, ok),
    );
  });
}

export async function askFolder(current: string, existing: string[]): Promise<string | null> {
  const id = `folders-${Math.random().toString(36).slice(2)}`;
  const input = h("input", { class: "cm-input", value: current, list: id, autofocus: true, "aria-label": "Klasör adı", placeholder: "örn. İstatistik" });
  const v = await form("Klasöre taşı", [
    h("label", { class: "cm-label", text: "Klasör (boş bırakırsan klasörden çıkar)" }), input,
    h("datalist", { id }, ...existing.map((f) => h("option", { value: f }))),
    existing.length ? h("div", { class: "cm-form__chips" }, ...existing.map((f) => h("button", { type: "button", class: "cm-chip", onclick: () => (input.value = f) }, f))) : null,
  ], "Taşı", () => input.value.trim());
  return v as string | null;
}

export async function askTags(current: string[], existing: string[]): Promise<string[] | null> {
  const input = h("input", { class: "cm-input", value: current.join(", "), autofocus: true, "aria-label": "Etiketler", placeholder: "vize, final, okuma" });
  const add = (t: string) => {
    const list = input.value.split(",").map((x) => x.trim()).filter(Boolean);
    if (!list.includes(t)) input.value = [...list, t].join(", ");
  };
  const v = await form("Etiketler", [
    h("label", { class: "cm-label", text: "Virgülle ayır" }), input,
    existing.length ? h("div", { class: "cm-form__chips" }, ...existing.map((t) => h("button", { type: "button", class: "cm-chip", onclick: () => add(t) }, `#${t}`))) : null,
  ], "Kaydet", () => [...new Set(input.value.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean))]);
  return v as string[] | null;
}

export const COVERS = ["#1f4e79", "#2f7ed8", "#0f7b6c", "#3d8b37", "#b8860b", "#d9730d", "#a3221a", "#c2185b", "#6a3ea1", "#57524a"];

export async function askCover(current?: string): Promise<string | null> {
  let pick = current ?? "";
  const swatches = h("div", { class: "cm-form__chips", role: "radiogroup", "aria-label": "Kapak rengi" });
  const render = () => swatches.replaceChildren(
    h("button", { type: "button", class: `cm-chip${!pick ? " is-on" : ""}`, role: "radio", "aria-checked": String(!pick), onclick: () => ((pick = ""), render()) }, "İlk sayfa"),
    ...COVERS.map((c) => {
      const b = h("button", { type: "button", class: `cm-cover-swatch${pick === c ? " is-on" : ""}`, role: "radio", "aria-checked": String(pick === c), "aria-label": `Renk ${c}`, onclick: () => ((pick = c), render()) });
      b.style.background = c;
      return b;
    }),
  );
  render();
  const v = await form("Kapak", [h("p", { class: "cm-muted", style: "margin:0", text: "Kapak görünümünde ilk sayfa yerine düz renk." }), swatches], "Kaydet", () => pick);
  return v as string | null;
}

/** PIN sor. `confirm`: iki kez yazılır (yeni kilit). */
export async function askPin(title: string, text: string, confirm = false, error = ""): Promise<string | null> {
  const a = h("input", { class: "cm-input", type: "password", inputmode: "numeric", autocomplete: "off", autofocus: true, "aria-label": "PIN", minlength: 4 });
  const b = h("input", { class: "cm-input", type: "password", inputmode: "numeric", autocomplete: "off", "aria-label": "PIN tekrar" });
  const err = h("p", { class: "cm-field-error", role: "alert", text: error });
  const v = await form(title, [
    h("p", { style: "margin:0", text }),
    h("label", { class: "cm-label", text: "PIN (en az 4 karakter)" }), a,
    ...(confirm ? [h("label", { class: "cm-label", text: "PIN tekrar" }), b] : []),
    err,
  ], confirm ? "Kilitle" : "Aç", () => {
    if (a.value.length < 4) {
      err.textContent = "PIN en az 4 karakter olmalı.";
      return undefined;
    }
    if (confirm && a.value !== b.value) {
      err.textContent = "İki PIN aynı değil.";
      return undefined;
    }
    return a.value;
  });
  return v as string | null;
}

export interface NotebookChoice {
  name: string;
  template: Template;
  pages: number;
  landscape: boolean;
}

export async function askNotebook(): Promise<NotebookChoice | null> {
  const date = new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
  const name = h("input", { class: "cm-input", value: `Not defteri ${date}`, autofocus: true, "aria-label": "Ad" });
  let template: Template = "lined";
  let pages = 10;
  let landscape = false;
  const seg = <T,>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const el = h("div", { class: "cm-seg cm-seg--sm", role: "radiogroup", "aria-label": label });
    const render = () => el.replaceChildren(...opts.map(([v, l]) => h("button", { type: "button", role: "radio", "aria-checked": String(get() === v), class: get() === v ? "is-on" : "", onclick: () => (set(v), render()) }, l)));
    render();
    return el;
  };
  const v = await form("Yeni not defteri", [
    h("label", { class: "cm-label", text: "Ad" }), name,
    h("label", { class: "cm-label", text: "Sayfa" }), seg("Şablon", TEMPLATES, () => template, (t) => (template = t)),
    h("label", { class: "cm-label", text: "Sayfa sayısı (sonra Yaz modunda sona sayfa ekleyebilirsin)" }),
    seg("Sayfa sayısı", [[5, "5"], [10, "10"], [20, "20"], [50, "50"]], () => pages, (n) => (pages = n)),
    h("label", { class: "cm-label", text: "Yön" }), seg("Yön", [[false, "Dikey"], [true, "Yatay"]], () => landscape, (l) => (landscape = l)),
  ], "Oluştur", () => ({ name: name.value.trim() || `Not defteri ${date}`, template, pages, landscape }));
  return v as NotebookChoice | null;
}
