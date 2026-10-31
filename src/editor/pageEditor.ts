import type { PDFDocumentProxy } from "pdfjs-dist";
import { num } from "../format";
import { openPdf } from "../pdf/load";
import { h, isTyping, kbd, sha256 } from "../util";
import { openMenu } from "../ui/menu";
import { toast } from "../ui/toast";
import type { EditPage, OutlineNode, Source } from "./build";
import { openDialog } from "../ui/dialog";
import type { Rect } from "../types";

export type { EditPage, Source };

export interface EditorActions {
  /** Kaydedilen yeni kopya: çıktı ve sayfa haritası (hangi yeni sayfa hangi asıl sayfadan, kaç derece döndürülmüş). */
  saved(out: Uint8Array, name: string, pages: EditPage[], sourceHashes: Map<string, string>): void;
  askPassword(name: string, wrong: boolean): Promise<string | null>;
}

const THUMB_W = 148;
const THUMB_H = 204;
let keySeq = 0;
const newKey = () => `p${++keySeq}`;

/**
 * Düzenle modu: sayfa düzeyinde düzenleme. PDF'in içindeki metin düzenlenmez;
 * kayıt her zaman yeni bir kopyaya, orijinal dosya olduğu gibi kalır.
 */
export class PageEditor {
  readonly el: HTMLElement;
  private grid: HTMLElement;
  private main: HTMLElement;
  private selInfo: HTMLElement;
  private changesEl: HTMLElement;
  private warnEl: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private dropline: HTMLElement;
  private pages: EditPage[];
  private selected = new Set<string>();
  private focusKey: string | null = null;
  private anchorKey: string | null = null;
  private history: EditPage[][] = [];
  private sources = new Map<string, Source>();
  private thumbCache = new Map<string, Promise<HTMLCanvasElement | null>>();
  private observer: IntersectionObserver;
  private dragKeys: string[] = [];
  private dropIndex = -1;

  constructor(main: Source, private actions: EditorActions, private outline: OutlineNode[] = []) {
    this.sources.set(main.id, main);
    this.pages = Array.from({ length: main.doc.numPages }, (_, i) => ({ key: newKey(), src: main.id, index: i, rotation: 0 }));

    this.selInfo = h("b", { style: "font-weight:600" });
    const addBtn = h("button", { class: "cm-btn cm-btn--sm", "aria-haspopup": "menu" }, "Sayfa ekle ▾");
    addBtn.addEventListener("click", () => openMenu(addBtn, [
      { label: "Boş sayfa", run: () => this.insertBlank("blank") },
      { label: "Çizgili not sayfası", run: () => this.insertBlank("lined") },
      { label: "Kareli sayfa", hint: "işlem, grafik", run: () => this.insertBlank("grid") },
      { label: "Başka PDF'ten sayfalar…", run: () => this.pickOther() },
    ], "right"));
    const marginBtn = h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-haspopup": "menu" }, "Not alanı ▾");
    marginBtn.addEventListener("click", () => openMenu(marginBtn, [
      { label: "Yok", run: () => this.setMargin(0) },
      { label: "Sağa %25", hint: "kenar notları", run: () => this.setMargin(0.25) },
      { label: "Sağa %50", hint: "geniş not alanı", run: () => this.setMargin(0.5) },
    ]));
    const action = (label: string, key: string | null, run: () => void, danger = false) =>
      h("button", { class: `cm-btn cm-btn--ghost cm-btn--sm${danger ? " cm-btn--danger" : ""}`, onclick: run }, label, key ? " " : "", key ? kbd(key) : null);
    const bar = h("div", { class: "cm-actionbar", role: "toolbar", "aria-label": "Sayfa işlemleri" },
      this.selInfo, h("span", { class: "cm-bar__sep" }),
      action("Döndür", "R", () => this.rotate()),
      action("Kırp…", "K", () => this.openCrop()),
      marginBtn,
      action("Çoğalt", "Ctrl D", () => this.duplicate()),
      action("Sil", "Del", () => this.remove(), true),
      action("Ayrı PDF olarak kaydet", null, () => void this.save(true)),
      h("span", { class: "cm-bar__spacer" }),
      addBtn,
      h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.pickOther() }, "Başka PDF ekle"),
    );
    this.dropline = h("span", { class: "cm-dropline", "aria-hidden": "true", hidden: true });
    this.grid = h("div", { class: "cm-grid", role: "listbox", "aria-multiselectable": "true", "aria-label": "Sayfalar, sürükleyerek sırala", tabindex: "-1" });
    this.main = h("main", { class: "cm-editor__main", "aria-label": "Sayfalar" }, this.grid);
    this.changesEl = h("span", { class: "cm-muted" });
    this.undoBtn = h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.undo() }, "Geri al ", kbd("Ctrl Z"));
    this.warnEl = h("span", { class: "cm-muted", style: "font-size:12px;line-height:16px" });
    const foot = h("footer", { class: "cm-actionbar", style: "border-top:1px solid var(--line-strong);border-bottom:0;flex-wrap:wrap" },
      h("span", { class: "cm-trust", text: "Değişiklikler yeni bir kopyaya yazılır; orijinal dosyan olduğu gibi kalır." }),
      this.warnEl,
      h("span", { class: "cm-bar__spacer" }),
      this.changesEl, this.undoBtn,
      h("button", { class: "cm-btn cm-btn--primary cm-btn--sm", onclick: () => void this.save(false) }, "Kopyayı kaydet"),
    );
    this.el = h("div", { class: "cm-editor" }, bar, this.main, foot);

    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        this.observer.unobserve(e.target);
        void this.paintThumb(e.target as HTMLElement);
      }
    }, { root: this.main, rootMargin: "300px 0px" });

    this.grid.addEventListener("keydown", this.onKey);
    this.grid.addEventListener("dragover", this.onDragOver);
    this.grid.addEventListener("drop", this.onDrop);
    this.grid.addEventListener("dragleave", (e) => {
      if (!this.grid.contains(e.relatedTarget as Node)) this.dropline.hidden = true;
    });
    this.render();
    void this.countLinks(main.doc);
  }

  destroy(): void {
    this.observer.disconnect();
    for (const s of this.sources.values()) if (s.id !== "main") void s.doc.destroy();
  }

  get changes(): number {
    return this.history.length;
  }

  focus(): void {
    this.cards()[0]?.focus();
  }

  // ---------- Görünüm ----------

  private cards(): HTMLElement[] {
    return [...this.grid.querySelectorAll<HTMLElement>(".cm-pcard")];
  }

  private render(): void {
    const frag = document.createDocumentFragment();
    this.pages.forEach((p, i) => {
      const on = this.selected.has(p.key);
      const label = p.blank
        ? h("span", { class: "cm-tag", text: `Yeni · ${{ blank: "Boş", lined: "Çizgili", grid: "Kareli", dots: "Noktalı" }[p.blank]}` })
        : h("span", { class: "cm-num cm-muted", text: `${num(p.index + 1)}${p.src !== "main" ? ` · ${this.sources.get(p.src!)?.name ?? ""}` : ""}${p.rotation ? " · döndürüldü" : ""}${p.crop ? " · kırpıldı" : ""}${p.margin ? " · not alanı" : ""}` });
      const page = h("div", { class: `cm-pcard__page${p.blank === "grid" ? " cm-pcard__page--grid" : p.blank === "lined" ? " cm-pcard__page--lined" : ""}` });
      // Kırpılacak alanın dışı soluk; not alanı sağda çizgili şerit.
      if (p.crop) {
        const c = h("span", { class: "cm-pcard__crop", "aria-hidden": "true" });
        c.style.cssText = `left:${p.crop[0] * 100}%;top:${p.crop[1] * 100}%;width:${p.crop[2] * 100}%;height:${p.crop[3] * 100}%`;
        page.append(c);
      }
      if (p.margin) {
        const m = h("span", { class: "cm-pcard__margin", "aria-hidden": "true" });
        m.style.width = `${(p.margin / (1 + p.margin)) * 100}%`;
        page.append(m);
      }
      const card = h("div", {
        class: `cm-pcard${on ? " is-selected" : ""}`,
        role: "option",
        "aria-selected": String(on),
        "aria-label": `${i + 1}. sıra${p.blank ? ", yeni sayfa" : `, asıl sayfa ${p.index + 1}`}`,
        tabindex: this.focusKey === p.key || (!this.focusKey && i === 0) ? "0" : "-1",
        draggable: "true",
        "data-key": p.key,
      },
        h("span", { class: "cm-pcard__check" }, h("span", { class: `cm-check${on ? " is-on" : ""}`, "aria-hidden": "true" })),
        page,
        label,
      );
      card.addEventListener("click", (e) => this.onClick(e, p.key));
      card.addEventListener("dragstart", (e) => this.onDragStart(e, p.key));
      card.addEventListener("dragend", () => this.onDragEnd());
      card.addEventListener("focus", () => (this.focusKey = p.key));
      frag.append(card);
      if (!p.blank) this.observer.observe(card);
    });
    frag.append(this.dropline);
    this.grid.replaceChildren(frag);
    this.updateBars();
  }

  private updateBars(): void {
    const n = this.selected.size;
    this.selInfo.textContent = n ? `${num(n)} sayfa seçili` : `${num(this.pages.length)} sayfa`;
    this.changesEl.textContent = this.history.length ? `${num(this.history.length)} değişiklik ·` : "Değişiklik yok";
    this.undoBtn.disabled = !this.history.length;
  }

  private thumbFor(p: EditPage): Promise<HTMLCanvasElement | null> {
    const id = `${p.src}:${p.index}`;
    let c = this.thumbCache.get(id);
    if (!c) {
      c = (async () => {
        const src = this.sources.get(p.src!);
        if (!src) return null;
        const page = await src.doc.getPage(p.index + 1);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = Math.min(THUMB_W / vp1.width, THUMB_H / vp1.height) * Math.min(2, devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        try {
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        } catch {
          return null;
        }
        return canvas;
      })();
      this.thumbCache.set(id, c);
    }
    return c;
  }

  private async paintThumb(card: HTMLElement): Promise<void> {
    const p = this.pages.find((x) => x.key === card.dataset.key);
    if (!p || p.blank) return;
    const src = await this.thumbFor(p);
    if (!src || !card.isConnected) return;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d")!.drawImage(src, 0, 0);
    if (p.rotation) {
      // Çeyrek dönüşte kutuya sığması için küçült.
      const d = Math.min(THUMB_W / src.width, THUMB_H / src.height);
      const s = p.rotation % 180 ? Math.min(1, THUMB_W / (src.height * d), THUMB_H / (src.width * d)) : 1;
      c.style.transform = `rotate(${p.rotation}deg) scale(${s})`;
    }
    // Kırpma ve not alanı kaplamaları korunur.
    const holder = card.querySelector(".cm-pcard__page")!;
    holder.querySelector(":scope > canvas")?.remove();
    holder.prepend(c);
  }

  // ---------- Seçim ----------

  private onClick(e: MouseEvent, key: string): void {
    const keys = this.pages.map((p) => p.key);
    if (e.shiftKey && this.anchorKey) {
      const a = keys.indexOf(this.anchorKey);
      const b = keys.indexOf(key);
      this.selected = new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest(".cm-pcard__check")) {
      if (this.selected.has(key)) this.selected.delete(key);
      else this.selected.add(key);
      this.anchorKey = key;
    } else {
      this.selected = new Set([key]);
      this.anchorKey = key;
    }
    this.focusKey = key;
    this.render();
    this.cardFor(key)?.focus();
  }

  private cardFor(key: string): HTMLElement | null {
    return this.grid.querySelector<HTMLElement>(`.cm-pcard[data-key="${CSS.escape(key)}"]`);
  }

  /** İşlem hedefi: seçim varsa seçim, yoksa odaktaki sayfa. */
  private targets(): Set<string> {
    if (this.selected.size) return this.selected;
    return new Set(this.focusKey ? [this.focusKey] : []);
  }

  // ---------- İşlemler (her biri geri alınabilir) ----------

  private commit(next: EditPage[]): void {
    this.history.push(this.pages);
    this.pages = next;
    this.render();
    const key = this.focusKey;
    if (key) this.cardFor(key)?.focus();
  }

  undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.pages = prev;
    const keys = new Set(prev.map((p) => p.key));
    this.selected = new Set([...this.selected].filter((k) => keys.has(k)));
    this.render();
  }

  private rotate(): void {
    const t = this.targets();
    if (!t.size) return;
    this.commit(this.pages.map((p) => (t.has(p.key) ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  }

  private setMargin(m: number): void {
    const t = this.targets();
    if (!t.size) {
      toast("Önce sayfa seç.");
      return;
    }
    this.commit(this.pages.map((p) => (t.has(p.key) && !p.blank ? { ...p, margin: m || undefined } : p)));
  }

  /**
   * Kırpma: seçili (ya da odaktaki) sayfalara aynı kenar payları. Görünen sayfaya göre yüzde;
   * önizleme ilk sayfada canlı. Vurgular ve işaretler kırpılmış sayfadaki yerlerine taşınır.
   */
  private openCrop(): void {
    const t = this.targets();
    const first = this.pages.find((p) => t.has(p.key) && !p.blank);
    if (!first) return void toast("Önce kırpılacak sayfayı seç.");
    const d = openDialog({ title: t.size > 1 ? `Kırp · ${num(t.size)} sayfa` : "Kırp", width: 640 });
    const [cx, cy, cw, ch] = first.crop ?? [0, 0, 1, 1];
    const vals = { top: Math.round(cy * 100), left: Math.round(cx * 100), right: Math.round((1 - cx - cw) * 100), bottom: Math.round((1 - cy - ch) * 100) };
    const box = h("div", { class: "cm-crop__box", "aria-hidden": "true" });
    const pageBox = h("div", { class: "cm-crop__page" }, box);
    const frame = h("div", { class: "cm-crop__frame" }, pageBox);
    const draw = () => {
      box.style.cssText = `left:${vals.left}%;top:${vals.top}%;right:${vals.right}%;bottom:${vals.bottom}%`;
    };
    void this.thumbFor(first).then((src) => {
      if (!src) return;
      // Kırpma görünen (döndürülmüş) sayfaya göre: önizleme de döndürülmüş çizilir.
      const quarter = first.rotation % 180 !== 0;
      const c = document.createElement("canvas");
      c.width = quarter ? src.height : src.width;
      c.height = quarter ? src.width : src.height;
      const ctx = c.getContext("2d")!;
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((first.rotation * Math.PI) / 180);
      ctx.drawImage(src, -src.width / 2, -src.height / 2);
      pageBox.prepend(c);
    });
    const field = (k: keyof typeof vals, label: string) => {
      const input = h("input", { class: "cm-input", type: "number", min: 0, max: 45, step: 1, value: vals[k], "aria-label": `${label} kenardan kırp (%)` });
      input.addEventListener("input", () => {
        vals[k] = Math.max(0, Math.min(45, Number(input.value) || 0));
        draw();
      });
      return h("label", { class: "cm-crop__field" }, h("span", { class: "cm-muted", text: label }), input, h("span", { class: "cm-muted", text: "%" }));
    };
    draw();
    d.body.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:24px;align-items:start";
    d.body.append(frame, h("div", { style: "display:flex;flex-direction:column;gap:8px" },
      field("top", "Üst"), field("right", "Sağ"), field("bottom", "Alt"), field("left", "Sol"),
      h("p", { class: "cm-muted", style: "margin:4px 0 0;font-size:13px;line-height:18px", text: "Slaytlardaki boş kenarları ya da taranmış sayfadaki gölgeleri kırp. Kırpılan alandaki vurgular kopyaya taşınmaz." }),
    ));
    d.foot.append(
      h("button", { class: "cm-btn cm-btn--ghost", onclick: () => {
        this.commit(this.pages.map((p) => (t.has(p.key) ? { ...p, crop: undefined } : p)));
        d.close();
      } }, "Kırpmayı kaldır"),
      h("div", { style: "display:flex;gap:8px" },
        h("button", { class: "cm-btn", onclick: d.close }, "Vazgeç"),
        h("button", { class: "cm-btn cm-btn--primary", onclick: () => {
          const crop: Rect = [vals.left / 100, vals.top / 100, 1 - (vals.left + vals.right) / 100, 1 - (vals.top + vals.bottom) / 100];
          const none = !vals.left && !vals.top && !vals.right && !vals.bottom;
          this.commit(this.pages.map((p) => (t.has(p.key) && !p.blank ? { ...p, crop: none ? undefined : crop } : p)));
          d.close();
        } }, "Uygula"),
      ),
    );
  }

  private duplicate(): void {
    const t = this.targets();
    if (!t.size) return;
    const next: EditPage[] = [];
    const added = new Set<string>();
    for (const p of this.pages) {
      next.push(p);
      if (t.has(p.key)) {
        const copy = { ...p, key: newKey() };
        next.push(copy);
        added.add(copy.key);
      }
    }
    this.selected = added;
    this.commit(next);
  }

  private remove(): void {
    const t = this.targets();
    if (!t.size) return;
    if (t.size >= this.pages.length) {
      toast("Tüm sayfalar silinemez. En az bir sayfa kalmalı.");
      return;
    }
    const idx = this.pages.findIndex((p) => t.has(p.key));
    const next = this.pages.filter((p) => !t.has(p.key));
    this.focusKey = next[Math.min(idx, next.length - 1)]?.key ?? null;
    this.selected.clear();
    this.commit(next);
    toast(`${num(t.size)} sayfa silindi`, { label: "Geri al", shortcut: "Ctrl Z", run: () => this.undo() });
  }

  private insertBlank(kind: "blank" | "lined" | "grid"): void {
    const at = this.insertionPoint();
    const page: EditPage = { key: newKey(), src: null, index: -1, rotation: 0, blank: kind };
    const next = [...this.pages];
    next.splice(at, 0, page);
    this.selected = new Set([page.key]);
    this.focusKey = page.key;
    this.commit(next);
  }

  /** Yeni sayfalar odaktaki/seçili son sayfanın arkasına, yoksa sona eklenir. */
  private insertionPoint(): number {
    const t = this.targets();
    let last = -1;
    this.pages.forEach((p, i) => t.has(p.key) && (last = i));
    return last >= 0 ? last + 1 : this.pages.length;
  }

  private pickOther(): void {
    const input = h("input", { type: "file", accept: "application/pdf,.pdf" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let doc: PDFDocumentProxy;
      try {
        doc = await openPdf(bytes.slice(), (wrong) => this.actions.askPassword(file.name, wrong));
      } catch {
        toast(`„${file.name}" açılamadı. Bozuk ya da PDF olmayan bir dosya olabilir.`);
        return;
      }
      const id = `s${this.sources.size}`;
      this.sources.set(id, { id, name: file.name, bytes, doc, hash: await sha256(bytes.slice().buffer as ArrayBuffer) });
      const at = this.insertionPoint();
      const added = Array.from({ length: doc.numPages }, (_, i) => ({ key: newKey(), src: id, index: i, rotation: 0 }));
      const next = [...this.pages];
      next.splice(at, 0, ...added);
      this.selected = new Set(added.map((p) => p.key));
      this.focusKey = added[0]?.key ?? null;
      this.commit(next);
      toast(`${num(doc.numPages)} sayfa eklendi`);
    });
    input.click();
  }

  private move(keys: Set<string>, to: number): void {
    const moving = this.pages.filter((p) => keys.has(p.key));
    const before = this.pages.slice(0, to).filter((p) => !keys.has(p.key)).length;
    const rest = this.pages.filter((p) => !keys.has(p.key));
    rest.splice(before, 0, ...moving);
    if (rest.every((p, i) => p === this.pages[i])) return;
    this.commit(rest);
  }

  // ---------- Klavye ----------

  private columns(): number {
    const cards = this.cards();
    if (cards.length < 2) return 1;
    const top = cards[0].offsetTop;
    const n = cards.findIndex((c) => c.offsetTop !== top);
    return n < 0 ? cards.length : n;
  }

  /** Düzenle modunun sayfa düzeyindeki kısayolları. Uygulama düzeyindeki Ctrl Z buraya yönlenir. */
  handleKey(e: KeyboardEvent): boolean {
    if (isTyping(e)) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z") return this.undo(), true;
    if (ctrl && e.key.toLowerCase() === "d") return this.duplicate(), true;
    if (ctrl && e.key.toLowerCase() === "a") {
      this.selected = new Set(this.pages.map((p) => p.key));
      this.render();
      return true;
    }
    if (ctrl) return false;
    if (e.key === "Delete" || e.key === "Backspace") return this.remove(), true;
    if (e.key.toLowerCase() === "r") return this.rotate(), true;
    if (e.key.toLowerCase() === "k") return this.openCrop(), true;
    return false;
  }

  private onKey = (e: KeyboardEvent) => {
    const keys = this.pages.map((p) => p.key);
    const i = this.focusKey ? keys.indexOf(this.focusKey) : 0;
    const cols = this.columns();
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        // Sürüklemenin klavye karşılığı: seçili sayfaları taşı.
        const t = this.targets();
        const idxs = this.pages.map((p, k) => (t.has(p.key) ? k : -1)).filter((k) => k >= 0);
        const step = Math.sign(delta) * (Math.abs(delta) === 1 ? 1 : cols);
        const to = step > 0 ? Math.min(this.pages.length, idxs.at(-1)! + step + 1) : Math.max(0, idxs[0] + step);
        this.move(t, to);
        return;
      }
      const j = Math.min(keys.length - 1, Math.max(0, i + delta));
      this.focusKey = keys[j];
      if (e.shiftKey) {
        this.anchorKey ??= keys[i];
        const a = keys.indexOf(this.anchorKey);
        this.selected = new Set(keys.slice(Math.min(a, j), Math.max(a, j) + 1));
        this.render();
      } else {
        this.cards().forEach((c) => (c.tabIndex = c.dataset.key === keys[j] ? 0 : -1));
      }
      this.cardFor(keys[j])?.focus();
      this.cardFor(keys[j])?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const k = keys[i];
      if (this.selected.has(k)) this.selected.delete(k);
      else this.selected.add(k);
      this.anchorKey = k;
      this.render();
      this.cardFor(k)?.focus();
    }
  };

  // ---------- Sürükle-bırak ----------

  private onDragStart(e: DragEvent, key: string): void {
    if (!this.selected.has(key)) {
      this.selected = new Set([key]);
      this.render();
    }
    this.dragKeys = this.pages.filter((p) => this.selected.has(p.key)).map((p) => p.key);
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", this.dragKeys.join(","));
    const label = h("span", { class: "cm-kind cm-dragcount", text: `${num(this.dragKeys.length)} sayfa` });
    label.style.top = "-100px";
    document.body.append(label);
    e.dataTransfer!.setDragImage(label, 10, 10);
    setTimeout(() => label.remove(), 0);
    requestAnimationFrame(() => this.dragKeys.forEach((k) => this.cardFor(k)?.classList.add("is-dragging")));
  }

  private onDragEnd(): void {
    this.cards().forEach((c) => c.classList.remove("is-dragging"));
    this.dropline.hidden = true;
    this.dragKeys = [];
  }

  private onDragOver = (e: DragEvent) => {
    if (!this.dragKeys.length) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    // Kenara yaklaşınca ızgara kendiliğinden kayar.
    const box = this.main.getBoundingClientRect();
    if (e.clientY < box.top + 60) this.main.scrollTop -= 16;
    else if (e.clientY > box.bottom - 60) this.main.scrollTop += 16;

    const cards = this.cards();
    let best = cards.length;
    let lineX = 0;
    let lineY = 0;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top - 16) { best = i; break; }
      if (e.clientY <= r.bottom + 16 && e.clientX < r.left + r.width / 2) { best = i; break; }
    }
    const gridBox = this.grid.getBoundingClientRect();
    const ref = cards[Math.min(best, cards.length - 1)];
    if (ref) {
      const r = ref.getBoundingClientRect();
      lineX = (best < cards.length ? r.left - 17 : r.right + 15) - gridBox.left;
      lineY = r.top - gridBox.top;
    }
    this.dropIndex = best;
    this.dropline.hidden = false;
    this.dropline.style.left = `${lineX}px`;
    this.dropline.style.top = `${lineY}px`;
  };

  private onDrop = (e: DragEvent) => {
    if (!this.dragKeys.length) return;
    e.preventDefault();
    const keys = new Set(this.dragKeys);
    this.onDragEnd();
    this.move(keys, this.dropIndex);
  };

  // ---------- Bağlantı uyarısı ve kaydetme ----------

  /** Sayfa düzenleme PDF içi bağlantıları bozabilir: kaydetmeden önce tek satırla söyle. */
  private async countLinks(doc: PDFDocumentProxy): Promise<void> {
    let links = 0;
    const n = Math.min(doc.numPages, 600);
    for (let i = 1; i <= n; i++) {
      try {
        const annots = await (await doc.getPage(i)).getAnnotations();
        links += annots.filter((a) => a.subtype === "Link" && a.dest).length;
      } catch {
        /* sayfa okunamadı: sayma */
      }
    }
    // İçindekiler ağacı kopyaya taşınır; iç bağlantılar taşınmaz.
    this.warnEl.textContent = links ? `Bu dosyadaki ${num(links)} iç bağlantı yeni kopyada çalışmayabilir.` : "";
  }

  private async save(onlySelected: boolean): Promise<void> {
    const pages = onlySelected ? this.pages.filter((p) => this.selected.has(p.key)) : this.pages;
    if (!pages.length) {
      toast("Önce ayrı PDF yapılacak sayfaları seç.");
      return;
    }
    const mainName = this.sources.get("main")!.name.replace(/\.pdf$/i, "");
    const name = onlySelected ? `${mainName}-secilen-sayfalar.pdf` : `${mainName}-duzenlenmis.pdf`;
    try {
      const { buildPdf } = await import("./build"); // pdf-lib yalnızca kaydederken yüklenir
      const out = await buildPdf(pages, this.sources, this.outline);
      const hashes = new Map([...this.sources.values()].filter((x) => x.hash).map((x) => [x.id, x.hash!] as [string, string]));
      this.actions.saved(out, name, pages, hashes);
      if (!onlySelected) this.history = [];
      this.updateBars();
    } catch (err) {
      const encrypted = err instanceof Error && /encrypt/i.test(err.message);
      toast(encrypted
        ? "Parola korumalı dosyanın sayfaları tarayıcıda yeniden kaydedilemiyor. Parolasız bir kopyayla dene."
        : "Kopya kaydedilemedi. Sayfaları azaltıp yeniden dene.", undefined, 6000);
    }
  }
}
