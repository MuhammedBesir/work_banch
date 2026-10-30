import type { Color } from "../types";
import { COLORS } from "../types";
import { h, kbd, marker } from "../util";

export interface FloatActions {
  color(c: Color): void;
  note(): void;
  copy(): void;
  remove(): void;
}

export interface FloatAnchor {
  /** Araç çubuğunun iliştiği sayfa elemanı; çubuk sayfayla birlikte kayar. */
  pageEl: HTMLElement;
  /** Seçimin sayfa elemanına göre piksel kutusu. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const GAP = 8;
const TOP_LIMIT = 56;

/** Metin seçildiğinde çıkan yüzen araç çubuğu: 4 vurgu rengi, Not ekle, Kopyala (ve uygulandı halinde Sil). */
export class FloatBar {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private idleTimer = 0;
  mode: "new" | "applied" | null = null;

  constructor(private actions: FloatActions) {
    this.bar = h("div", { class: "cm-float", role: "toolbar", "aria-label": "Seçim araçları" });
    this.el = h("div", { class: "cm-floatwrap", hidden: true }, this.bar);
    this.el.addEventListener("mousedown", (e) => e.preventDefault()); // seçimi kaybetme
    this.el.addEventListener("mouseenter", () => clearTimeout(this.idleTimer));
    this.el.addEventListener("mouseleave", () => this.armIdle());
    this.bar.addEventListener("keydown", this.onKey);
    // Başka yere tıklanınca kapanır (sayfadaki yeni seçim çubuğu yeniden açar).
    document.addEventListener("mousedown", (e) => {
      if (this.open && !this.el.contains(e.target as Node)) this.hide();
    }, true);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(anchor: FloatAnchor, mode: "new" | "applied", names: Record<Color, string>, active?: Color, stageTop = 0): void {
    this.mode = mode;
    this.bar.replaceChildren(
      ...COLORS.map((c) => {
        const b = h("button", {
          class: `cm-float__sw cm-float__sw--${c}${active === c ? " is-active" : ""}`,
          "aria-label": `${names[c]} olarak vurgula (${c})`,
          "aria-pressed": active === c ? "true" : undefined,
          tabindex: "-1",
          onclick: () => this.actions.color(c),
        }, marker(c), h("span", { class: "cm-tip", role: "tooltip", text: `${names[c]} · ${c}` }));
        return b;
      }),
      h("span", { class: "cm-float__sep" }),
      h("button", { class: "cm-float__act", tabindex: "-1", onclick: () => this.actions.note() }, "Not ekle ", kbd("N")),
      h("button", { class: "cm-float__act", tabindex: "-1", onclick: () => this.actions.copy() }, "Kopyala ", kbd("C")),
      ...(mode === "applied"
        ? [h("span", { class: "cm-float__sep" }), h("button", { class: "cm-float__act cm-float__act--danger", tabindex: "-1", onclick: () => this.actions.remove() }, "Sil ", kbd("Del"))]
        : []),
    );
    (this.bar.querySelector("button") as HTMLButtonElement).tabIndex = 0;
    anchor.pageEl.append(this.el);
    this.el.hidden = false;
    this.el.classList.toggle("is-mobile", matchMedia("(max-width: 720px)").matches);

    // Konum: seçimin 8px üstü; ekranın üst kenarına 56px'ten yakınsa seçimin altı.
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const pageBox = anchor.pageEl.getBoundingClientRect();
    const selTopOnScreen = pageBox.top + anchor.top - stageTop;
    const above = selTopOnScreen - hgt - GAP >= TOP_LIMIT;
    const top = above ? anchor.top - hgt - GAP : anchor.bottom + GAP;
    const center = (anchor.left + anchor.right) / 2;
    const left = Math.min(Math.max(0, center - w / 2), Math.max(0, pageBox.width - w));
    this.el.style.top = `${top}px`;
    this.el.style.left = `${left}px`;
    // Yeniden tetiklenen açılış animasyonu
    this.el.style.animation = "none";
    void this.el.offsetWidth;
    this.el.style.animation = "";
    if (mode === "applied") this.armIdle();
    else clearTimeout(this.idleTimer);
  }

  /** Uygulandı hali 2 sn hareketsiz kalırsa kapanır. */
  private armIdle(): void {
    clearTimeout(this.idleTimer);
    if (this.mode !== "applied") return;
    this.idleTimer = window.setTimeout(() => {
      if (!this.el.matches(":hover") && !this.el.contains(document.activeElement)) this.hide();
    }, 2000);
  }

  hide(): void {
    clearTimeout(this.idleTimer);
    this.el.hidden = true;
    this.mode = null;
  }

  focus(): void {
    (this.bar.querySelector('button[tabindex="0"]') as HTMLButtonElement | null)?.focus();
  }

  private onKey = (e: KeyboardEvent) => {
    const btns = [...this.bar.querySelectorAll<HTMLButtonElement>("button")];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % btns.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + btns.length) % btns.length;
    if (next < 0) return;
    e.preventDefault();
    btns.forEach((b, k) => (b.tabIndex = k === next ? 0 : -1));
    btns[next].focus();
  };
}
