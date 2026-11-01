import type { PDFDocumentProxy } from "pdfjs-dist";
import { num } from "../format";
import type { OutlineItem } from "../pdf/load";
import type { Color, Mark } from "../types";
import { drawingsSvg } from "../write/layer";
import { h, marker } from "../util";
import { icon } from "./icons";

export interface RailActions {
  goTo(page: number): void;
  wideChange(wide: boolean): void;
}

const THUMB_W = 72;

/** Sol şerit: küçük sayfa önizlemeleri ve ikinci sekmede içindekiler + yer imleri. */
export class Rail {
  readonly el: HTMLElement;
  private thumbs: HTMLElement;
  private outlineEl: HTMLElement;
  private tabs: HTMLButtonElement[];
  private buttons: HTMLButtonElement[] = [];
  private observer: IntersectionObserver;
  private current = 0;
  private outline: OutlineItem[] = [];
  private bookmarks: number[] = [];
  private tab: "pages" | "toc" = "pages";

  constructor(private doc: PDFDocumentProxy, private actions: RailActions) {
    this.thumbs = h("div", { class: "cm-rail__thumbs" });
    this.outlineEl = h("div", { class: "cm-outline", hidden: true });
    this.tabs = [
      h("button", { class: "cm-tab is-on", "aria-pressed": "true", title: "Sayfalar", onclick: () => this.setTab("pages") }, icon("pages"), h("span", { class: "cm-tab__t", text: "Sayfalar" })),
      h("button", { class: "cm-tab", "aria-pressed": "false", title: "İçindekiler", onclick: () => this.setTab("toc") }, icon("toc"), h("span", { class: "cm-tab__t", text: "İçindekiler" })),
    ];
    this.el = h("nav", { class: "cm-rail", "aria-label": "Sayfa önizlemeleri ve içindekiler" },
      h("div", { class: "cm-rail__tabs" }, ...this.tabs), this.thumbs, this.outlineEl);
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.observer.unobserve(e.target);
        void this.drawThumb(Number((e.target as HTMLElement).dataset.page));
      }
    }, { root: this.thumbs, rootMargin: "400px 0px" });

    for (let i = 0; i < doc.numPages; i++) {
      const page = h("span", { class: "cm-thumb__page" });
      page.style.height = "100px";
      const b = h("button", { class: "cm-thumb", "aria-label": `Sayfa ${i + 1}`, "data-page": i, onclick: () => actions.goTo(i) },
        page, h("span", { class: "cm-num cm-muted", text: num(i + 1) }));
      this.buttons.push(b);
      this.thumbs.append(b);
      this.observer.observe(b);
    }
  }

  destroy(): void {
    this.observer.disconnect();
  }

  setTab(tab: "pages" | "toc"): void {
    this.tab = tab;
    this.tabs.forEach((t, i) => {
      const on = (i === 0) === (tab === "pages");
      t.classList.toggle("is-on", on);
      t.setAttribute("aria-pressed", String(on));
    });
    this.thumbs.hidden = tab !== "pages";
    this.outlineEl.hidden = tab !== "toc";
    this.actions.wideChange(tab === "toc");
    if (tab === "toc") this.renderOutline();
    else this.scrollToCurrent();
  }

  get activeTab(): "pages" | "toc" {
    return this.tab;
  }

  private async drawThumb(i: number): Promise<void> {
    const page = await this.doc.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = (THUMB_W * Math.min(2, devicePixelRatio || 1)) / vp1.width;
    const vp = page.getViewport({ scale });
    const canvas = h("canvas", { "aria-hidden": "true" });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    try {
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    } catch {
      return;
    }
    const holder = this.buttons[i].querySelector<HTMLElement>(".cm-thumb__page")!;
    holder.style.height = "";
    holder.prepend(canvas);
  }

  setCurrent(i: number): void {
    this.buttons[this.current]?.classList.remove("is-current");
    this.buttons[this.current]?.setAttribute("aria-label", `Sayfa ${this.current + 1}`);
    this.current = i;
    this.buttons[i]?.classList.add("is-current");
    this.buttons[i]?.setAttribute("aria-label", `Sayfa ${i + 1}, geçerli sayfa`);
    if (this.tab === "pages") this.scrollToCurrent();
    else this.markOutlineCurrent();
  }

  /**
   * Geçerli küçük sayfayı görünür tut. Kaydırırken sayfa sık değişir: konum okuması (zorunlu yerleşim
   * hesabı) bir sonraki kareye ertelenir ve birleştirilir.
   */
  private scrollFrame = 0;
  private scrollToCurrent(): void {
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => this.scrollNow());
  }

  private scrollNow(): void {
    const b = this.buttons[this.current];
    if (!b || this.thumbs.hidden) return;
    const top = b.offsetTop - this.thumbs.offsetTop;
    if (top < this.thumbs.scrollTop || top + b.offsetHeight > this.thumbs.scrollTop + this.thumbs.clientHeight) {
      this.thumbs.scrollTop = top - this.thumbs.clientHeight / 3;
    }
  }

  /** Küçük sayfanın köşesindeki renk şekilleri: o sayfada hangi vurgular var. */
  setMarks(byPage: Map<number, Set<Color>>): void {
    this.buttons.forEach((b, i) => {
      const holder = b.querySelector(".cm-thumb__page")!;
      holder.querySelector(".cm-thumb__dots")?.remove();
      const colors = byPage.get(i);
      if (colors?.size) {
        holder.append(h("span", { class: "cm-thumb__dots" }, ...[...colors].sort().map((c) => marker(c))));
      }
    });
  }

  /** Yaz modu çizimleri küçük sayfa önizlemesinde de görünür. */
  setDrawings(byPage: Map<number, Mark[]>): void {
    this.buttons.forEach((b, i) => {
      const holder = b.querySelector<HTMLElement>(".cm-thumb__page")!;
      holder.querySelector(":scope > .cm-ink")?.remove();
      const list = (byPage.get(i) ?? []).filter((m) => m.kind === "ink" || m.kind === "shape");
      if (!list.length) return;
      const w = 600;
      const hgt = w * ((holder.clientHeight || 100) / (holder.clientWidth || 72));
      holder.append(drawingsSvg(list, w, hgt));
    });
  }

  setBookmarks(list: number[]): void {
    this.bookmarks = [...list].sort((a, b) => a - b);
    this.buttons.forEach((b, i) => {
      const holder = b.querySelector(".cm-thumb__page")!;
      holder.querySelector(".cm-thumb__mark")?.remove();
      if (this.bookmarks.includes(i)) holder.append(h("span", { class: "cm-thumb__mark", "aria-label": "Yer imi", text: "B" }));
    });
    if (this.tab === "toc") this.renderOutline();
  }

  setOutline(items: OutlineItem[]): void {
    this.outline = items;
    if (this.tab === "toc") this.renderOutline();
  }

  private renderOutline(): void {
    const tree = (items: OutlineItem[]): HTMLElement =>
      h("ul", {}, ...items.map((it) =>
        h("li", {},
          h("button", {
            "data-page": it.page ?? "",
            disabled: it.page === null,
            onclick: () => it.page !== null && this.actions.goTo(it.page),
          }, h("span", { text: it.title }), it.page !== null ? h("span", { class: "cm-num cm-muted", text: num(it.page + 1) }) : null),
          it.children.length ? tree(it.children) : null,
        ),
      ));
    this.outlineEl.replaceChildren(
      h("p", { class: "cm-label cm-outline__h", text: "Yer imleri" }),
      this.bookmarks.length
        ? h("ul", { class: "cm-outline__bm" }, ...this.bookmarks.map((p) =>
            h("li", {}, h("button", { "data-page": p, onclick: () => this.actions.goTo(p) }, h("span", { text: `Sayfa ${num(p + 1)}` }), h("span", { class: "cm-num cm-muted", text: num(p + 1) }))),
          ))
        : h("p", { class: "cm-outline__empty" }, "Yer imi yok. Okuduğun sayfaya ", h("span", { class: "cm-kbd", text: "B" }), " ile ekle."),
      h("p", { class: "cm-label cm-outline__h", text: "İçindekiler" }),
      this.outline.length ? tree(this.outline) : h("p", { class: "cm-outline__empty", text: "Bu PDF'in içindekiler bilgisi yok." }),
    );
    this.markOutlineCurrent();
  }

  private markOutlineCurrent(): void {
    const btns = [...this.outlineEl.querySelectorAll<HTMLButtonElement>("button[data-page]")].filter((b) => b.dataset.page !== "");
    btns.forEach((b) => b.classList.remove("is-current"));
    // İçindekilerde, okunan sayfadan önceki son başlık.
    const best = btns.filter((b) => Number(b.dataset.page) <= this.current && !b.closest(".cm-outline__bm"))
      .reduce<HTMLButtonElement | null>((acc, b) => (!acc || Number(b.dataset.page) >= Number(acc.dataset.page) ? b : acc), null);
    best?.classList.add("is-current");
  }
}
