/**
 * Basit sanal liste: yalnızca görünen satırlar (ve az bir pay) DOM'da.
 * Satır yükseklikleri ölçüldükçe hatırlanır; ölçülmeyenler için tahmin kullanılır.
 */
export interface VItem {
  key: string;
  estimate: number;
  build(): HTMLElement;
}

const OVERSCAN = 600; // px

export class VirtualList {
  private items: VItem[] = [];
  private heights = new Map<string, number>();
  private offsets: number[] = [];
  private top: HTMLElement;
  private bottom: HTMLElement;
  private frame = 0;
  private rendered: [number, number] = [0, -1];
  /** Çizili satırlar: kaydırınca yeniden kullanılır (odak ve not alanı kaybolmasın). */
  private nodes = new Map<string, HTMLElement>();

  constructor(private host: HTMLElement) {
    this.top = document.createElement("div");
    this.bottom = document.createElement("div");
    this.top.setAttribute("aria-hidden", "true");
    this.bottom.setAttribute("aria-hidden", "true");
    host.addEventListener("scroll", () => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.paint());
    }, { passive: true });
  }

  get count(): number {
    return this.items.length;
  }

  setItems(items: VItem[]): void {
    this.items = items;
    this.rendered = [0, -1];
    this.nodes.clear();
    this.layout();
    this.paint(true);
  }

  private layout(): void {
    let y = 0;
    this.offsets = this.items.map((it) => {
      const at = y;
      y += this.heights.get(it.key) ?? it.estimate;
      return at;
    });
    this.offsets.push(y);
  }

  private indexAt(y: number): number {
    let lo = 0;
    let hi = this.items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /** Görünen pencereyi çiz; ölçülen yükseklikler tahminden farklıysa yerleşimi düzelt. */
  paint(force = false): void {
    if (!this.items.length) {
      this.host.replaceChildren();
      return;
    }
    const from = this.indexAt(Math.max(0, this.host.scrollTop - OVERSCAN));
    const to = this.indexAt(this.host.scrollTop + this.host.clientHeight + OVERSCAN);
    if (!force && from === this.rendered[0] && to === this.rendered[1]) return;
    this.rendered = [from, to];
    const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-vkey]")?.dataset.vkey;
    const nodes: HTMLElement[] = [];
    const next = new Map<string, HTMLElement>();
    for (let i = from; i <= to; i++) {
      const key = this.items[i].key;
      let el = force ? undefined : this.nodes.get(key);
      if (!el) {
        el = this.items[i].build();
        el.dataset.vkey = key;
      }
      next.set(key, el);
      nodes.push(el);
    }
    this.nodes = next;
    this.top.style.height = `${this.offsets[from]}px`;
    this.bottom.style.height = `${this.offsets[this.items.length] - this.offsets[to + 1]}px`;
    const scroll = this.host.scrollTop;
    const current = [...this.host.children];
    const wanted = [this.top, ...nodes, this.bottom];
    if (current.length !== wanted.length || current.some((c, i) => c !== wanted[i])) this.host.replaceChildren(...wanted);
    let changed = false;
    for (const el of nodes) {
      const hgt = el.offsetHeight;
      const key = el.dataset.vkey!;
      if (hgt && Math.abs((this.heights.get(key) ?? -1) - hgt) > 1) {
        this.heights.set(key, hgt);
        changed = true;
      }
    }
    if (changed) {
      this.layout();
      this.top.style.height = `${this.offsets[from]}px`;
      this.bottom.style.height = `${this.offsets[this.items.length] - this.offsets[to + 1]}px`;
    }
    this.host.scrollTop = scroll;
    if (focusKey && !this.host.contains(document.activeElement)) this.nodes.get(focusKey)?.focus({ preventScroll: true });
  }

  /** Öğeyi listenin başına getir; ölçülen yükseklikler tahmini değiştirirse konumu bir kez daha düzelt. */
  scrollToStart(key: string): void {
    for (let k = 0; k < 3; k++) {
      const top = this.offsetOf(key);
      if (top === null || Math.abs(this.host.scrollTop - top) < 1) return;
      this.host.scrollTop = top;
      this.paint();
    }
  }

  /** Bir öğeyi görünür alana getir ve çizilmiş elemanını döndür. */
  reveal(key: string, block: "nearest" | "start" = "nearest"): HTMLElement | null {
    const i = this.items.findIndex((it) => it.key === key);
    if (i < 0) return null;
    const top = this.offsets[i];
    const bottom = this.offsets[i + 1];
    const view = this.host.scrollTop;
    if (block === "start") this.host.scrollTop = top;
    else if (top < view) this.host.scrollTop = top;
    else if (bottom > view + this.host.clientHeight) this.host.scrollTop = bottom - this.host.clientHeight;
    this.paint(true);
    return this.host.querySelector<HTMLElement>(`[data-vkey="${CSS.escape(key)}"]`);
  }

  /** Klavye gezintisi: bir öncekine / sonrakine (yalnızca seçilebilir öğelerde). */
  neighbor(key: string, dir: 1 | -1, selectable: (key: string) => boolean): string | null {
    let i = this.items.findIndex((it) => it.key === key) + dir;
    while (i >= 0 && i < this.items.length) {
      if (selectable(this.items[i].key)) return this.items[i].key;
      i += dir;
    }
    return null;
  }

  firstKey(selectable: (key: string) => boolean): string | null {
    return this.items.find((it) => selectable(it.key))?.key ?? null;
  }

  offsetOf(key: string): number | null {
    const i = this.items.findIndex((it) => it.key === key);
    return i < 0 ? null : this.offsets[i];
  }
}
