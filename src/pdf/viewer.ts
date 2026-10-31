import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { pdfjs } from "./load";
import { fold } from "../format";
import { normalizeRects } from "../geometry";
import type { Highlight, Rect, ScrollMode } from "../types";
import { buildOcrLayer, type OcrPage } from "../ocr/ocr";
import { h, marker, prefersReducedMotion } from "../util";

export type ZoomMode = "width" | "page" | "custom";

/** Seçimden çıkan vurgu adayı: sayfa başına dikdörtgenler ve metin. */
export interface SelectionPart {
  page: number;
  rects: Rect[];
  text: string;
}

export interface ViewerEvents {
  pageChange(index: number): void;
  selection(parts: SelectionPart[]): void;
  selectionCleared(): void;
  highlightClick(id: string): void;
  scroll(): void;
  zoomChange(): void;
}

interface PageView {
  index: number;
  el: HTMLDivElement;
  /** Ölçek 1'deki boyut (PDF noktası). */
  w: number;
  h: number;
  sized: boolean;
  canvas: HTMLCanvasElement | null;
  text: HTMLDivElement | null;
  hl: HTMLDivElement;
  search: HTMLDivElement;
  renderedScale: number;
  task: RenderTask | null;
  textLayer: InstanceType<typeof pdfjs.TextLayer> | null;
}

const GAP = 24; // space-6: PDF sayfaları arası
const PAD_X = 48; // space-12: sayfa kenarı ile okuma alanı arası
const RENDER_AROUND = 2; // görünen sayfa ±2 çizilir
const KEEP_AROUND = 5; // bundan uzak sayfaların canvas'ı bırakılır
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;

export class Viewer {
  readonly root: HTMLDivElement;
  private pages: PageView[] = [];
  private tops: number[] = [];
  scale = 1;
  zoomMode: ZoomMode = "width";
  scrollMode: ScrollMode = "continuous";
  current = 0;
  private renderTimer = 0;
  private resizeObs: ResizeObserver;
  private destroyed = false;
  private highlightsFor: (page: number) => Highlight[] = () => [];
  /** Metni olmayan (taranmış) sayfa için OCR sonucu; varsa metin katmanı ondan kurulur. */
  ocrFor: (page: number) => OcrPage | null = () => null;
  /** Tanınmış el yazısı: metin katmanına eklenir, aranabilir. */
  hwFor: (page: number) => OcrPage | null = () => null;

  constructor(
    readonly stage: HTMLElement,
    readonly doc: PDFDocumentProxy,
    private events: ViewerEvents,
  ) {
    this.root = h("div", { class: "cm-pages" });
    stage.replaceChildren(this.root);
    this.resizeObs = new ResizeObserver(() => this.onResize());
    stage.addEventListener("scroll", this.onScroll, { passive: true });
    stage.addEventListener("wheel", this.onWheel, { passive: false });
    stage.addEventListener("mouseup", this.onMouseUp);
    stage.addEventListener("keyup", this.onKeyUp);
    stage.addEventListener("pointerdown", this.onSwipeStart);
  }

  /** Sayfa sayfa modda dokunmatik: yatay kaydırma bir sonraki / önceki sayfaya geçer. */
  private onSwipeStart = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || this.scrollMode !== "paged") return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const t0 = performance.now();
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (ev.type === "pointercancel" && Math.abs(ev.clientX - x0) < 1) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - t0 < 800) this.next(dx < 0 ? 1 : -1);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** İlk sayfanın boyutuyla hemen yerleşir, diğer sayfaların gerçek boyutu arkada okunur. */
  async init(highlightsFor: (page: number) => Highlight[], startPage = 0): Promise<void> {
    this.highlightsFor = highlightsFor;
    const first = await this.doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    for (let i = 0; i < this.doc.numPages; i++) {
      const el = h("div", { class: "cm-page", "data-page": i, role: "region", "aria-label": `Sayfa ${i + 1}` });
      const hl = h("div", { class: "cm-page__hl" });
      const search = h("div", { class: "cm-page__search" });
      el.append(hl, search);
      this.root.append(el);
      this.pages.push({
        index: i, el, w: vp.width, h: vp.height, sized: i === 0, canvas: null, text: null, hl, search,
        renderedScale: 0, task: null, textLayer: null,
      });
    }
    if (vp.width > vp.height) {
      this.scrollMode = "paged";
      this.zoomMode = "page";
    }
    this.fitScale();
    this.layout();
    this.resizeObs.observe(this.stage);
    this.goTo(startPage, "instant");
    this.scheduleRender(0);
    void this.measureAll();
  }

  private async measureAll(): Promise<void> {
    let changed = false;
    for (const p of this.pages) {
      if (this.destroyed) return;
      if (p.sized) continue;
      const page = await this.doc.getPage(p.index + 1);
      const vp = page.getViewport({ scale: 1 });
      if (vp.width !== p.w || vp.height !== p.h) {
        p.w = vp.width;
        p.h = vp.height;
        changed = true;
      }
      p.sized = true;
      // Her 50 sayfada bir yerleşimi düzelt; kaydırma çubuğu zıplamasın diye okunan noktayı koru.
      if (changed && p.index % 50 === 49) {
        this.relayoutKeepingAnchor();
        changed = false;
      }
    }
    if (changed) this.relayoutKeepingAnchor();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObs.disconnect();
    clearTimeout(this.renderTimer);
    this.stage.removeEventListener("scroll", this.onScroll);
    this.stage.removeEventListener("wheel", this.onWheel);
    this.stage.removeEventListener("mouseup", this.onMouseUp);
    this.stage.removeEventListener("keyup", this.onKeyUp);
    this.stage.removeEventListener("pointerdown", this.onSwipeStart);
    for (const p of this.pages) this.release(p);
    this.stage.replaceChildren();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  pageElement(i: number): HTMLDivElement | undefined {
    return this.pages[i]?.el;
  }

  // ---------- Yerleşim ve zoom ----------

  private maxWidth(): number {
    return Math.max(...this.pages.map((p) => p.w));
  }

  private fitScale(): void {
    if (this.zoomMode === "custom") return;
    const availW = Math.max(200, this.stage.clientWidth - PAD_X * 2 - this.reserveLeft);
    const availH = Math.max(200, this.stage.clientHeight - GAP * 2);
    const ref = this.pages[this.current] ?? this.pages[0];
    const byWidth = availW / this.maxWidth();
    this.scale = this.zoomMode === "width" ? byWidth : Math.min(availW / ref.w, availH / ref.h);
    this.scale = clamp(this.scale, ZOOM_MIN, ZOOM_MAX);
  }

  private layout(): void {
    let y = GAP;
    this.tops = [];
    for (const p of this.pages) {
      const w = Math.round(p.w * this.scale);
      const hgt = Math.round(p.h * this.scale);
      p.el.style.width = `${w}px`;
      p.el.style.height = `${hgt}px`;
      this.tops.push(y);
      y += hgt + GAP;
    }
    this.root.style.minWidth = `${Math.round(this.maxWidth() * this.scale) + PAD_X * 2 + this.reserveLeft}px`;
    this.root.style.paddingLeft = this.reserveLeft ? `${PAD_X + this.reserveLeft}px` : "";
    this.root.style.setProperty("--z", String(this.scale)); // Yaz modu katmanı zoom ile ölçeklenir
    this.root.classList.toggle("is-paged", this.scrollMode === "paged");
    for (const p of this.pages) this.drawHighlights(p.index);
  }

  /** Okunan noktayı (sayfa + sayfa içi oran) bulur. */
  private anchor(clientY = this.stage.clientHeight * 0.3, clientX = this.stage.clientWidth / 2) {
    const y = this.stage.scrollTop + clientY;
    const i = this.pageAt(y);
    const p = this.pages[i];
    const top = this.tops[i];
    const fy = (y - top) / (p.h * this.scale);
    const left = p.el.offsetLeft;
    const fx = (this.stage.scrollLeft + clientX - left) / (p.w * this.scale);
    return { i, fx, fy, clientX, clientY };
  }

  private restore(a: ReturnType<Viewer["anchor"]>): void {
    const p = this.pages[a.i];
    this.stage.scrollTop = this.tops[a.i] + a.fy * p.h * this.scale - a.clientY;
    this.stage.scrollLeft = p.el.offsetLeft + a.fx * p.w * this.scale - a.clientX;
  }

  private relayoutKeepingAnchor(clientX?: number, clientY?: number): void {
    const a = this.anchor(clientY, clientX);
    this.layout();
    this.restore(a);
    this.scheduleRender();
  }

  setZoom(mode: ZoomMode, value?: number, at?: { x: number; y: number }): void {
    const a = this.anchor(at?.y, at?.x);
    this.zoomMode = mode;
    if (mode === "custom" && value !== undefined) this.scale = clamp(value, ZOOM_MIN, ZOOM_MAX);
    else this.fitScale();
    this.layout();
    this.restore(a);
    this.scheduleRender();
    this.events.zoomChange();
  }

  zoomBy(factor: number, at?: { x: number; y: number }): void {
    this.setZoom("custom", Math.round(this.scale * factor * 20) / 20, at);
  }

  setScrollMode(mode: ScrollMode): void {
    this.scrollMode = mode;
    if (mode === "paged" && this.zoomMode === "width") this.zoomMode = "page";
    this.setZoom(this.zoomMode, this.scale);
    this.goTo(this.current, "instant");
  }

  /** Soldan ayrılan boşluk (Yaz modu paleti sayfanın üstüne binmesin). */
  private reserveLeft = 0;
  setReserveLeft(px: number): void {
    if (px === this.reserveLeft) return;
    this.reserveLeft = px;
    const a = this.anchor();
    this.fitScale();
    this.layout();
    this.restore(a);
    this.scheduleRender();
    this.events.zoomChange();
  }

  private onResize = () => {
    if (this.zoomMode !== "custom") {
      const a = this.anchor();
      this.fitScale();
      this.layout();
      this.restore(a);
    }
    this.scheduleRender();
  };

  private onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    // Ctrl + tekerlek imleç noktasına çapalı yakınlaştırır.
    e.preventDefault();
    const box = this.stage.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0025);
    const next = clamp(this.scale * factor, ZOOM_MIN, ZOOM_MAX);
    const a = this.anchor(e.clientY - box.top, e.clientX - box.left);
    this.zoomMode = "custom";
    this.scale = next;
    this.layout();
    this.restore(a);
    this.scheduleRender(120);
    this.events.zoomChange();
  };

  // ---------- Kaydırma ----------

  private pageAt(y: number): number {
    let lo = 0;
    let hi = this.tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid] - GAP / 2 <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private onScroll = () => {
    const i = this.pageAt(this.stage.scrollTop + this.stage.clientHeight * 0.3);
    if (i !== this.current) {
      this.current = i;
      this.events.pageChange(i);
    }
    this.events.scroll();
    this.scheduleRender(60);
  };

  goTo(i: number, behavior: ScrollBehavior = "instant"): void {
    i = clamp(i, 0, this.pages.length - 1);
    const p = this.pages[i];
    let top = this.tops[i] - GAP;
    if (this.scrollMode === "paged") top = this.tops[i] - Math.max(0, (this.stage.clientHeight - p.h * this.scale) / 2);
    this.stage.scrollTo({ top, behavior: prefersReducedMotion() ? "instant" : behavior });
    if (this.current !== i) {
      this.current = i;
      this.events.pageChange(i);
    }
    this.scheduleRender(0);
  }

  next(delta = 1): void {
    this.goTo(this.current + delta, this.scrollMode === "paged" ? "instant" : "smooth");
  }

  /**
   * Vurguya atlama: görünürse kaydırma yok; ±3 sayfa içindeyse yumuşak kaydırma;
   * daha uzaksa animasyonsuz anında atlama. Varışta tek seferlik parlama.
   */
  reveal(page: number, rect: Rect | undefined, flashId?: string): void {
    const p = this.pages[page];
    if (!p) return;
    const ry = rect ? rect[1] * p.h * this.scale : 0;
    const rh = rect ? rect[3] * p.h * this.scale : 0;
    const absTop = this.tops[page] + ry;
    const viewTop = this.stage.scrollTop;
    const viewBottom = viewTop + this.stage.clientHeight;
    const visible = absTop >= viewTop + 8 && absTop + rh <= viewBottom - 8;
    if (!visible) {
      const target = absTop - this.stage.clientHeight / 3;
      const near = Math.abs(page - this.current) <= 3;
      this.stage.scrollTo({ top: target, behavior: near && !prefersReducedMotion() ? "smooth" : "instant" });
    }
    if (rect) {
      const fx = rect[0] * p.w * this.scale;
      const left = p.el.offsetLeft + fx;
      if (left < this.stage.scrollLeft || left > this.stage.scrollLeft + this.stage.clientWidth - 40) {
        this.stage.scrollLeft = left - 40;
      }
    }
    if (flashId) setTimeout(() => this.flash(flashId), visible ? 0 : 260);
    this.scheduleRender(0);
  }

  flash(id: string): void {
    const rects = this.root.querySelectorAll<HTMLElement>(`.cm-hlrect[data-id="${CSS.escape(id)}"]`);
    if (prefersReducedMotion()) {
      // Hareket azaltıldıysa: 1,5 sn sabit odak çerçevesi.
      rects.forEach((r) => r.classList.add("is-focus"));
      setTimeout(() => rects.forEach((r) => r.classList.remove("is-focus")), 1500);
      return;
    }
    rects.forEach((r) => {
      r.classList.remove("is-flash");
      void r.offsetWidth;
      r.classList.add("is-flash");
    });
  }

  // ---------- Çizim ----------

  scheduleRender(delay = 30): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.renderVisible(), delay);
  }

  private renderVisible(): void {
    if (this.destroyed) return;
    const first = this.pageAt(this.stage.scrollTop);
    const last = this.pageAt(this.stage.scrollTop + this.stage.clientHeight);
    const from = Math.max(0, first - RENDER_AROUND);
    const to = Math.min(this.pages.length - 1, last + RENDER_AROUND);
    for (const p of this.pages) {
      if (p.index >= from && p.index <= to) {
        if (Math.abs(p.renderedScale - this.scale) > 0.001) void this.renderPage(p);
      } else if (p.index < first - KEEP_AROUND || p.index > last + KEEP_AROUND) {
        this.release(p);
      }
    }
  }

  private release(p: PageView): void {
    p.task?.cancel();
    p.task = null;
    p.textLayer?.cancel();
    p.textLayer = null;
    p.canvas?.remove();
    p.canvas = null;
    p.text?.remove();
    p.text = null;
    p.renderedScale = 0;
  }

  private async renderPage(p: PageView): Promise<void> {
    const scale = this.scale;
    p.task?.cancel();
    p.textLayer?.cancel();
    let page: PDFPageProxy;
    try {
      page = await this.doc.getPage(p.index + 1);
    } catch {
      return;
    }
    if (this.destroyed || scale !== this.scale) return;
    const vp = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = h("canvas", { class: "cm-page__canvas", "aria-hidden": "true" });
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const task = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    p.task = task;
    try {
      await task.promise;
    } catch {
      return; // iptal edildi
    }
    if (this.destroyed || p.task !== task) return;
    p.task = null;
    p.canvas?.remove();
    p.el.prepend(canvas);
    p.canvas = canvas;
    p.renderedScale = scale;

    // Metin katmanı: seçim ve arama için, canvas'ın ve vurgu katmanının üstünde, saydam.
    const text = h("div", { class: "textLayer" });
    text.style.setProperty("--scale-factor", String(scale));
    const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: vp });
    p.textLayer = tl;
    try {
      await tl.render();
    } catch {
      return;
    }
    if (this.destroyed || p.textLayer !== tl) return;
    if (!text.textContent?.trim()) {
      const ocr = this.ocrFor(p.index);
      if (ocr) buildOcrLayer(text, ocr, vp.width, vp.height);
    }
    const hw = this.hwFor(p.index);
    if (hw) buildOcrLayer(text, hw, vp.width, vp.height, true);
    p.text?.remove();
    p.el.append(text);
    p.text = text;
    this.textReady.get(p.index)?.forEach((fn) => fn());
    this.textReady.delete(p.index);
  }

  /** OCR ya da el yazısı sonucu geldikten sonra çizili sayfanın metin katmanını yeniden kur. */
  refreshText(i: number): void {
    const p = this.pages[i];
    if (!p?.text) return;
    p.renderedScale = 0;
    this.scheduleRender(0);
  }

  private textReady = new Map<number, (() => void)[]>();

  /** Sayfanın metin katmanı hazır olunca çözülür (gerekirse sayfayı çizdirir). */
  whenText(i: number): Promise<HTMLDivElement> {
    const p = this.pages[i];
    if (p.text && Math.abs(p.renderedScale - this.scale) < 0.001) return Promise.resolve(p.text);
    return new Promise((resolve) => {
      const list = this.textReady.get(i) ?? [];
      list.push(() => resolve(p.text!));
      this.textReady.set(i, list);
      if (Math.abs(p.renderedScale - this.scale) > 0.001 && !p.task) void this.renderPage(p);
    });
  }

  /** Vurgu katmanı canvas'ın üstünde, pdf-soften filtresinin DIŞINDA çizilir. */
  drawHighlights(i: number): void {
    const p = this.pages[i];
    if (!p) return;
    const W = p.w * this.scale;
    const H = p.h * this.scale;
    const frag = document.createDocumentFragment();
    for (const hl of this.highlightsFor(i)) {
      hl.rects.forEach(([x, y, w, hh], k) => {
        const r = h("div", { class: `cm-hlrect cm-hl--${hl.color}`, "data-id": hl.id });
        r.style.cssText = `left:${x * W}px;top:${y * H}px;width:${w * W}px;height:${hh * H}px`;
        frag.append(r);
        if (k === 0) {
          const m = marker(hl.color);
          m.classList.add("cm-margin");
          m.style.top = `${y * H + Math.max(0, (hh * H - 10) / 2)}px`;
          frag.append(m);
        }
      });
    }
    p.hl.replaceChildren(frag);
  }

  redrawAllHighlights(): void {
    for (const p of this.pages) this.drawHighlights(p.index);
  }

  // ---------- Seçim ----------

  private onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0) return;
    // Fare bırakıldıktan 100 ms sonra yüzen araç çubuğu açılır.
    setTimeout(() => this.readSelection(e), 100);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.shiftKey && e.key.startsWith("Arrow")) this.readSelection();
  };

  private readSelection(e?: MouseEvent): void {
    const parts = this.selectionParts();
    if (parts.length) {
      this.events.selection(parts);
      return;
    }
    if (e) {
      const id = this.highlightAtPoint(e.clientX, e.clientY);
      if (id) {
        this.events.highlightClick(id);
        return;
      }
    }
    this.events.selectionCleared();
  }

  selectionParts(): SelectionPart[] {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return [];
    const range = sel.getRangeAt(0);
    const parts: SelectionPart[] = [];
    for (const p of this.pages) {
      if (!p.text || !range.intersectsNode(p.text)) continue;
      const sub = range.cloneRange();
      if (!p.text.contains(range.startContainer)) sub.setStart(p.text, 0);
      if (!p.text.contains(range.endContainer)) sub.setEnd(p.text, p.text.childNodes.length);
      const rects = normalizeRects(textRects(sub), p.el.getBoundingClientRect());
      const text = sub.toString().replace(/\s+/g, " ").trim();
      if (rects.length && text) parts.push({ page: p.index, rects, text });
    }
    return parts;
  }

  private highlightAtPoint(cx: number, cy: number): string | null {
    const els = document.elementsFromPoint(cx, cy);
    const pageEl = els.find((el) => el.classList.contains("cm-page")) as HTMLElement | undefined;
    if (!pageEl) return null;
    const i = Number(pageEl.dataset.page);
    const box = pageEl.getBoundingClientRect();
    const fx = (cx - box.left) / box.width;
    const fy = (cy - box.top) / box.height;
    const hit = this.highlightsFor(i).filter((hl) =>
      hl.rects.some(([x, y, w, hh]) => fx >= x && fx <= x + w && fy >= y && fy <= y + hh),
    );
    return hit.at(-1)?.id ?? null;
  }

  /** Sayfa koordinatında (piksel, sayfa elemanına göre) bir vurgunun ilk dikdörtgeni. */
  rectPx(page: number, r: Rect): { left: number; top: number; width: number; height: number } {
    const p = this.pages[page];
    const W = p.w * this.scale;
    const H = p.h * this.scale;
    return { left: r[0] * W, top: r[1] * H, width: r[2] * W, height: r[3] * H };
  }

  // ---------- Arama ----------

  /** Metin katmanında k'inci eşleşmenin dikdörtgenleri. */
  async findRects(page: number, query: string, occurrence: number): Promise<Rect[]> {
    const text = await this.whenText(page);
    const { str, map } = layerString(text);
    const hay = fold(str);
    const needle = fold(query);
    let at = -1;
    for (let k = 0; k <= occurrence; k++) {
      at = hay.indexOf(needle, at + 1);
      if (at < 0) return [];
    }
    const range = rangeFor(map, at, at + needle.length);
    if (!range) return [];
    return normalizeRects(textRects(range), this.pages[page].el.getBoundingClientRect());
  }

  /** Sayfadaki bütün eşleşmelerin dikdörtgenleri (en fazla 200). */
  async findAllRects(page: number, query: string): Promise<Rect[][]> {
    const text = await this.whenText(page);
    const { str, map } = layerString(text);
    const hay = fold(str);
    const needle = fold(query);
    const box = this.pages[page].el.getBoundingClientRect();
    const out: Rect[][] = [];
    let at = hay.indexOf(needle);
    while (at >= 0 && needle && out.length < 200) {
      const range = rangeFor(map, at, at + needle.length);
      if (range) out.push(normalizeRects(textRects(range), box));
      at = hay.indexOf(needle, at + needle.length);
    }
    return out;
  }

  /** Sayfadaki tüm arama eşleşmeleri soluk, geçerli olan belirgin. */
  showSearchHits(page: number, all: Rect[][], current: number): void {
    for (const p of this.pages) p.search.replaceChildren();
    const p = this.pages[page];
    const W = p.w * this.scale;
    const H = p.h * this.scale;
    all.forEach((rects, k) => {
      for (const [x, y, w, hh] of rects) {
        const r = h("div", { class: k === current ? "cm-searchhit" : "cm-searchhit cm-searchhit--other" });
        r.style.cssText = `left:${x * W - 2}px;top:${y * H - 2}px;width:${w * W + 4}px;height:${hh * H + 4}px`;
        p.search.append(r);
      }
    });
  }

  /** Arama eşleşmesi ya da AI kaynağının dayanak metni (`cite`: noktalı alt çizgi). */
  showSearchHit(page: number | null, rects: Rect[], kind: "search" | "cite" = "search"): void {
    for (const p of this.pages) p.search.replaceChildren();
    if (page === null) return;
    const p = this.pages[page];
    const W = p.w * this.scale;
    const H = p.h * this.scale;
    for (const [x, y, w, hh] of rects) {
      const r = h("div", { class: kind === "cite" ? "cm-citehit" : "cm-searchhit" });
      r.style.cssText = `left:${x * W - 2}px;top:${y * H - 2}px;width:${w * W + 4}px;height:${hh * H + 4}px`;
      p.search.append(r);
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Aralıktaki yalnızca metin düğümlerinin kutuları (boş div ve <br> kutuları vurguyu bozar). */
function textRects(range: Range): DOMRect[] {
  const out: DOMRect[] = [];
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? root.parentNode! : root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!range.intersectsNode(node)) continue;
    const r = document.createRange();
    r.selectNodeContents(node);
    if (node === range.startContainer) r.setStart(node, range.startOffset);
    if (node === range.endContainer) r.setEnd(node, range.endOffset);
    out.push(...r.getClientRects());
  }
  return out;
}

/** Metin katmanının düz metni; <br> boşluk sayılır. Her karakterin hangi düğümde olduğunu tutar. */
function layerString(root: HTMLElement): { str: string; map: { node: Text; start: number }[] } {
  let str = "";
  const map: { node: Text; start: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      map.push({ node: node as Text, start: str.length });
      str += node.textContent ?? "";
    } else if ((node as Element).tagName === "BR") {
      str += " ";
    }
  }
  return { str, map };
}

function rangeFor(map: { node: Text; start: number }[], from: number, to: number): Range | null {
  const locate = (pos: number) => {
    for (let i = map.length - 1; i >= 0; i--) {
      if (map[i].start <= pos) return { node: map[i].node, offset: Math.min(pos - map[i].start, map[i].node.length) };
    }
    return null;
  };
  const a = locate(from);
  const b = locate(to);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}
