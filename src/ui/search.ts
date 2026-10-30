import type { PDFDocumentProxy } from "pdfjs-dist";
import { fold, num } from "../format";
import { pageText } from "../pdf/load";
import { h, kbd } from "../util";

export interface Match {
  page: number;
  /** Sayfa içindeki kaçıncı eşleşme. */
  occurrence: number;
  before: string;
  hit: string;
  after: string;
}

export interface SearchActions {
  show(m: Match | null, query: string): void;
  close(): void;
}

/** Ctrl F: sonuçlar sayfa numarasıyla listede, Enter / Shift Enter gezer. */
export class Search {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private count: HTMLElement;
  private list: HTMLElement;
  private texts: (string | null)[];
  private matches: Match[] = [];
  private index = -1;
  private run = 0;
  private timer = 0;

  constructor(
    private doc: PDFDocumentProxy,
    private actions: SearchActions,
    /** Sayfa metni; taranmış sayfada OCR metnine düşer. */
    private pageTextOf: (i: number) => Promise<string> = (i) => pageText(doc, i),
  ) {
    this.texts = new Array(doc.numPages).fill(null);
    this.input = h("input", { class: "cm-input", type: "search", placeholder: "Belgede ara", "aria-label": "Belgede ara" });
    this.count = h("span", { class: "cm-num cm-search__count", "aria-live": "polite" });
    this.list = h("div", { class: "cm-search__list", role: "listbox", "aria-label": "Arama sonuçları" });
    this.el = h("div", { class: "cm-search", role: "search", hidden: true },
      h("div", { class: "cm-search__row" },
        this.input,
        this.count,
        h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-label": "Önceki sonuç (Shift Enter)", onclick: () => this.step(-1) }, "‹"),
        h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-label": "Sonraki sonuç (Enter)", onclick: () => this.step(1) }, "›"),
        h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-label": "Aramayı kapat (Esc)", onclick: () => this.close() }, kbd("Esc")),
      ),
      this.list,
    );
    this.input.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.search(this.input.value), 180);
    });
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(initial?: string): void {
    this.el.hidden = false;
    if (initial) {
      this.input.value = initial;
      void this.search(initial);
    }
    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.el.hidden = true;
    this.actions.show(null, "");
    this.actions.close();
  }

  /** OCR'dan sonra önbelleği boşalt; açık arama yeniden çalışsın. */
  invalidate(): void {
    this.texts.fill(null);
    if (this.isOpen && this.input.value) void this.search(this.input.value);
  }

  private async text(i: number): Promise<string> {
    // Satır sonları boşluk sayılır: kelime iki satıra bölünse de arama bulur.
    return (this.texts[i] ??= (await this.pageTextOf(i)).replace(/\n/g, " "));
  }

  private async search(q: string): Promise<void> {
    const run = ++this.run;
    this.matches = [];
    this.index = -1;
    this.list.replaceChildren();
    const needle = fold(q.trim());
    if (needle.length < 2) {
      this.count.textContent = "";
      this.actions.show(null, "");
      return;
    }
    this.count.textContent = "…";
    for (let i = 0; i < this.doc.numPages; i++) {
      const t = await this.text(i);
      if (run !== this.run) return;
      const hay = fold(t);
      let at = hay.indexOf(needle);
      let k = 0;
      while (at >= 0) {
        const m: Match = {
          page: i,
          occurrence: k++,
          before: t.slice(Math.max(0, at - 40), at),
          hit: t.slice(at, at + needle.length),
          after: t.slice(at + needle.length, at + needle.length + 60),
        };
        this.matches.push(m);
        if (this.matches.length <= 300) this.list.append(this.row(m, this.matches.length - 1));
        at = hay.indexOf(needle, at + needle.length);
      }
      if (i % 20 === 19) this.updateCount();
    }
    if (this.matches.length > 300) {
      this.list.append(h("p", { class: "cm-search__note", text: `İlk 300 sonuç gösteriliyor; ${num(this.matches.length)} sonucun hepsi Enter ile gezilebilir.` }));
    }
    if (!this.matches.length) this.list.append(h("p", { class: "cm-search__note", text: "Bu belgede bulunamadı. Taranmış sayfalarda arama çalışmaz." }));
    this.updateCount();
    if (this.matches.length) this.go(0);
  }

  private row(m: Match, i: number): HTMLElement {
    return h("button", { class: "cm-search__item", role: "option", "data-i": i, onclick: () => this.go(i) },
      h("span", { class: "cm-num cm-muted", text: `s. ${num(m.page + 1)}` }),
      h("span", {}, "…" + m.before, h("b", { text: m.hit }), m.after + "…"),
    );
  }

  private updateCount(): void {
    const n = this.matches.length;
    this.count.textContent = n ? `${this.index >= 0 ? num(this.index + 1) : "–"} / ${num(n)}` : "0";
  }

  private step(d: number): void {
    if (!this.matches.length) return;
    this.go((this.index + d + this.matches.length) % this.matches.length);
  }

  private go(i: number): void {
    this.index = i;
    this.updateCount();
    this.list.querySelectorAll(".is-on").forEach((x) => x.classList.remove("is-on"));
    const row = this.list.querySelector<HTMLElement>(`[data-i="${i}"]`);
    row?.classList.add("is-on");
    row?.scrollIntoView({ block: "nearest" });
    this.actions.show(this.matches[i], this.input.value.trim());
  }
}
