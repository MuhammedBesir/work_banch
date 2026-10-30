import type { Viewer } from "../pdf/viewer";
import type { Mark, PenColor, ShapeKind } from "../types";
import { PEN_COLORS } from "../types";
import { h, isTyping, kbd, uid } from "../util";
import { hitMark, moveMark, simplify } from "./geometry";
import { PEN_LABEL } from "./layer";

export type Tool = "select" | "highlight" | "pen" | "text" | "sticky" | "shape" | "eraser";

const TOOLS: [Tool, string, string][] = [
  ["select", "Seç", "V"],
  ["highlight", "Vurgu", "H"],
  ["pen", "Kalem", "P"],
  ["text", "Metin", "T"],
  ["sticky", "Not", "S"],
  ["shape", "Şekil", "R"],
  ["eraser", "Silgi", "E"],
];
const SHAPES: [ShapeKind, string][] = [["rect", "Dikdörtgen"], ["ellipse", "Daire"], ["arrow", "Ok"]];
const WIDTHS = [1, 2, 4];

type Op = { add: Mark } | { remove: Mark } | { before: Mark; after: Mark };

export interface WriteActions {
  marks(): Mark[];
  add(m: Mark): void;
  update(m: Mark): void;
  remove(id: string): void;
  /** Sayfanın işaret katmanını yeniden çiz (seçim/araç değişince). */
  redraw(page: number): void;
  pen(color: PenColor, width: number): void;
  announce(text: string): void;
}

const SVG = "http://www.w3.org/2000/svg";

/**
 * Yaz modu: sayfanın soluna yüzen palet ve sayfa üstü işaretleme.
 * Parmak dokunuşu Yaz modunda da yalnızca kaydırır (avuç reddi); fare ve kalem çizer.
 */
export class WriteMode {
  readonly el: HTMLElement;
  tool: Tool = "pen";
  shape: ShapeKind = "rect";
  color: PenColor;
  width: number;
  selectedId: string | null = null;
  editingId: string | null = null;
  private undoStack: Op[][] = [];
  private redoStack: Op[][] = [];
  private active = false;

  constructor(
    private viewer: Viewer,
    private fileHash: string,
    pen: { color: PenColor; width: number },
    private actions: WriteActions,
  ) {
    this.color = pen.color;
    this.width = pen.width;
    this.el = h("div", { class: "cm-palette", role: "toolbar", "aria-label": "Yazma araçları", "aria-orientation": "vertical" });
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.renderPalette();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Metin kutusu/not yalnızca bu araçlarla tıklanabilir; kalem ve şekil üstlerinden geçer. */
  get editableMarks(): boolean {
    return this.active && (this.tool === "select" || this.tool === "text" || this.tool === "sticky" || this.tool === "eraser");
  }

  enable(): void {
    this.active = true;
    this.viewer.root.addEventListener("pointerdown", this.onDown);
    this.viewer.root.addEventListener("dblclick", this.onDblClick);
    this.syncOverlay();
  }

  disable(): void {
    this.finishEditing();
    this.active = false;
    this.selectedId = null;
    this.viewer.root.removeEventListener("pointerdown", this.onDown);
    this.viewer.root.removeEventListener("dblclick", this.onDblClick);
    this.viewer.root.classList.remove("is-writing", "is-tool-pen", "is-tool-shape", "is-tool-eraser", "is-tool-text", "is-tool-sticky", "is-tool-select", "is-tool-highlight");
  }

  setTool(t: Tool): void {
    this.finishEditing();
    this.tool = t;
    this.select(null);
    this.renderPalette();
    this.syncOverlay();
    const label = TOOLS.find((x) => x[0] === t)![1];
    this.actions.announce(`${label} aracı`);
  }

  private syncOverlay(): void {
    const root = this.viewer.root;
    root.classList.toggle("is-writing", this.active && this.tool !== "highlight");
    for (const [t] of TOOLS) root.classList.toggle(`is-tool-${t}`, this.active && this.tool === t);
    for (let i = 0; i < this.viewer.pageCount; i++) this.actions.redraw(i);
  }

  setColor(c: PenColor): void {
    this.color = c;
    this.actions.pen(this.color, this.width);
    this.renderPalette();
    if (this.selectedId) this.recolorSelected(c);
  }

  private setWidth(w: number): void {
    this.width = w;
    this.actions.pen(this.color, this.width);
    this.renderPalette();
  }

  private renderPalette(): void {
    const tool = ([t, label, key]: [Tool, string, string]) =>
      h("button", { class: `cm-tool${this.tool === t ? " is-on" : ""}`, "aria-pressed": String(this.tool === t), title: `${label} (${key})`, onclick: () => this.setTool(t) }, label, kbd(key));
    const shapes = this.tool === "shape"
      ? [h("div", { class: "cm-palette__sep" }), ...SHAPES.map(([s, label]) =>
          h("button", { class: `cm-tool cm-tool--sub${this.shape === s ? " is-on" : ""}`, "aria-pressed": String(this.shape === s), onclick: () => ((this.shape = s), this.renderPalette()) }, label))]
      : [];
    this.el.replaceChildren(
      ...TOOLS.map(tool),
      ...shapes,
      h("div", { class: "cm-palette__sep" }),
      ...PEN_COLORS.map((c, i) =>
        h("button", { class: `cm-pen cm-pen--${c}${this.color === c ? " is-on" : ""}`, "aria-label": `${PEN_LABEL[c]} (Shift ${i + 1})`, "aria-pressed": String(this.color === c), title: `${PEN_LABEL[c]} · Shift ${i + 1}`, onclick: () => this.setColor(c) })),
      h("div", { class: "cm-palette__sep" }),
      ...WIDTHS.map((w) => {
        const b = h("button", { class: `cm-width${this.width === w ? " is-on" : ""}`, "aria-label": `Kalınlık ${w}`, "aria-pressed": String(this.width === w), onclick: () => this.setWidth(w) }, h("i"));
        (b.firstChild as HTMLElement).style.height = `${w + 0.5}px`;
        return b;
      }),
      h("div", { class: "cm-palette__sep" }),
      h("button", { class: "cm-tool", title: "Geri al (Ctrl Z)", disabled: !this.undoStack.length, onclick: () => this.undo() }, "Geri al", kbd("Ctrl Z")),
    );
  }

  // ---------- Geri al / yinele ----------

  private record(ops: Op[]): void {
    if (!ops.length) return;
    this.undoStack.push(ops);
    this.redoStack = [];
    this.renderPalette();
  }

  private apply(ops: Op[], reverse: boolean): void {
    for (const op of reverse ? [...ops].reverse() : ops) {
      if ("add" in op) reverse ? this.actions.remove(op.add.id) : this.actions.add(op.add);
      else if ("remove" in op) reverse ? this.actions.add(op.remove) : this.actions.remove(op.remove.id);
      else this.actions.update(reverse ? op.before : op.after);
    }
  }

  undo(): void {
    this.finishEditing();
    const ops = this.undoStack.pop();
    if (!ops) return;
    this.apply(ops, true);
    this.redoStack.push(ops);
    this.select(null);
    this.renderPalette();
  }

  redo(): void {
    const ops = this.redoStack.pop();
    if (!ops) return;
    this.apply(ops, false);
    this.undoStack.push(ops);
    this.renderPalette();
  }

  // ---------- Klavye ----------

  handleKey(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z") return e.shiftKey ? this.redo() : this.undo(), true;
    if (ctrl && e.key.toLowerCase() === "y") return this.redo(), true;
    if (ctrl || e.altKey || isTyping(e)) return false;
    if (e.shiftKey && /^Digit[1-3]$/.test(e.code)) return this.setColor(PEN_COLORS[Number(e.code.slice(5)) - 1]), true;
    if ((e.key === "Delete" || e.key === "Backspace") && this.selectedId) {
      const m = this.find(this.selectedId);
      if (m) {
        this.actions.remove(m.id);
        this.record([{ remove: m }]);
        this.selectedId = null;
      }
      return true;
    }
    const t = TOOLS.find((x) => x[2].toLowerCase() === e.key.toLowerCase());
    if (t && !e.shiftKey) return this.setTool(t[0]), true;
    return false;
  }

  // ---------- Seçim ----------

  private find(id: string): Mark | undefined {
    return this.actions.marks().find((m) => m.id === id);
  }

  private select(id: string | null): void {
    const prev = this.selectedId ? this.find(this.selectedId) : undefined;
    this.selectedId = id;
    if (prev) this.actions.redraw(prev.page);
    const cur = id ? this.find(id) : undefined;
    if (cur && cur.page !== prev?.page) this.actions.redraw(cur.page);
  }

  private recolorSelected(c: PenColor): void {
    const m = this.find(this.selectedId!);
    if (!m || m.kind === "sticky") return;
    const after = { ...m, color: c, updatedAt: Date.now() } as Mark;
    this.actions.update(after);
    this.record([{ before: m, after }]);
  }

  // ---------- İşaretçi ----------

  private pageAt(e: PointerEvent | MouseEvent): { page: number; el: HTMLElement; x: number; y: number; w: number; h: number } | null {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-page");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { page: Number(el.dataset.page), el, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
  }

  private onDown = (e: PointerEvent) => {
    if (this.tool === "highlight" || e.button > 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".cm-floatwrap, .cm-sticky__toggle")) return;
    if (this.editingId && target.closest("[contenteditable]")) return;
    // Avuç reddi: parmak yalnızca kaydırır.
    if (e.pointerType === "touch") return this.fingerScroll(e);
    const at = this.pageAt(e);
    if (!at) return;
    this.finishEditing();
    e.preventDefault();
    switch (this.tool) {
      case "pen": return this.drawInk(e, at);
      case "shape": return this.drawShape(e, at);
      case "eraser": return this.erase(e, at);
      case "text": return this.createText(at, "text");
      case "sticky": return this.createText(at, "sticky");
      case "select": return this.pick(e, at);
    }
  };

  private onDblClick = (e: MouseEvent) => {
    if (!this.active || this.tool === "highlight") return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-textbox, .cm-sticky");
    if (el?.dataset.id) this.edit(el.dataset.id);
  };

  private fingerScroll(e: PointerEvent): void {
    const stage = this.viewer.stage;
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      stage.scrollBy(lx - ev.clientX, ly - ev.clientY);
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /** Geçici SVG: çizgi canvas yerine doğrudan SVG yoluna eklenir; bırakınca seyreltilip kaydedilir. */
  private live(pageEl: HTMLElement): { svg: SVGSVGElement; done(): void } {
    const svgEl = document.createElementNS(SVG, "svg");
    svgEl.setAttribute("viewBox", "0 0 1 1");
    svgEl.setAttribute("preserveAspectRatio", "none");
    svgEl.classList.add("cm-ink", "cm-ink--live");
    pageEl.append(svgEl);
    return { svg: svgEl, done: () => svgEl.remove() };
  }

  private track(e: PointerEvent, el: HTMLElement, onMove: (pts: [number, number, number][]) => void, onUp: () => void): void {
    el.setPointerCapture?.(e.pointerId);
    const box = el.getBoundingClientRect();
    const norm = (ev: PointerEvent): [number, number, number] => [
      Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height)),
      ev.pointerType === "pen" ? ev.pressure : 0.5,
    ];
    onMove([norm(e)]);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const list = ev.getCoalescedEvents?.() ?? [ev];
      onMove((list.length ? list : [ev]).map(norm));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onUp();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  private drawInk(e: PointerEvent, at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const live = this.live(at.el);
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("class", `cm-stroke cm-stroke--${this.color}`);
    path.setAttribute("style", `stroke-width:calc(${this.width}px * var(--z, 1))`);
    live.svg.append(path);
    const pts: [number, number][] = [];
    let pressure = 0;
    let d = "";
    this.track(e, at.el, (list) => {
      for (const [x, y, p] of list) {
        d += `${pts.length ? " L" : "M"}${x.toFixed(5)} ${y.toFixed(5)}`;
        pts.push([x, y]);
        pressure += p;
      }
      path.setAttribute("d", d);
    }, () => {
      live.done();
      if (!pts.length) return;
      // Kalem basıncı: ortalama basınç çizgi kalınlığını 0,6×–1,4× arasında ölçekler.
      const avg = pressure / pts.length;
      const width = e.pointerType === "pen" ? +(this.width * (0.6 + 0.8 * avg)).toFixed(2) : this.width;
      const m: Mark = { id: uid(), fileHash: this.fileHash, page: at.page, kind: "ink", color: this.color, width, points: simplify(pts), createdAt: Date.now(), updatedAt: Date.now() };
      this.actions.add(m);
      this.record([{ add: m }]);
    });
  }

  private drawShape(e: PointerEvent, at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const live = this.live(at.el);
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("class", `cm-stroke cm-stroke--${this.color}`);
    path.setAttribute("style", `stroke-width:calc(${this.width}px * var(--z, 1))`);
    live.svg.append(path);
    let from: [number, number] | null = null;
    let to: [number, number] = [0, 0];
    this.track(e, at.el, (list) => {
      const [x, y] = list[list.length - 1];
      from ??= [x, y];
      to = [x, y];
      const [x0, y0] = from;
      path.setAttribute("d", this.shape === "rect"
        ? `M${x0} ${y0} H${x} V${y} H${x0} Z`
        : this.shape === "ellipse"
          ? ellipsePath(x0, y0, x, y)
          : `M${x0} ${y0} L${x} ${y}`);
    }, () => {
      live.done();
      if (!from || Math.hypot((to[0] - from[0]) * at.w, (to[1] - from[1]) * at.h) < 6) return;
      const m: Mark = { id: uid(), fileHash: this.fileHash, page: at.page, kind: "shape", shape: this.shape, color: this.color, width: this.width, from, to, createdAt: Date.now(), updatedAt: Date.now() };
      this.actions.add(m);
      this.record([{ add: m }]);
    });
  }

  /** Silgi bütün çizgiyi siler (kısmi silme yok, tahmin edilebilir olsun). */
  private erase(e: PointerEvent, at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const removed: Mark[] = [];
    this.track(e, at.el, (list) => {
      for (const [x, y] of list) {
        for (const m of this.actions.marks()) {
          if (m.page !== at.page || removed.includes(m)) continue;
          if (hitMark(m, x, y, at.w, at.h)) {
            removed.push(m);
            this.actions.remove(m.id);
          }
        }
      }
    }, () => this.record(removed.map((m) => ({ remove: m }))));
  }

  private pick(e: PointerEvent, at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const hit = [...this.actions.marks()].reverse().find((m) => m.page === at.page && hitMark(m, at.x, at.y, at.w, at.h));
    this.select(hit?.id ?? null);
    if (!hit) return;
    // Sürükleyerek taşı.
    const start: [number, number] = [at.x, at.y];
    let last: [number, number] = start;
    const el = this.viewer.root.querySelectorAll<Element>(`[data-id="${CSS.escape(hit.id)}"]`);
    this.track(e, at.el, (list) => {
      const [x, y] = list[list.length - 1];
      last = [x, y];
      const dx = (x - start[0]) * at.w;
      const dy = (y - start[1]) * at.h;
      el.forEach((n) => ((n as HTMLElement).style.translate = `${dx}px ${dy}px`));
    }, () => {
      const dx = last[0] - start[0];
      const dy = last[1] - start[1];
      if (Math.abs(dx * at.w) < 2 && Math.abs(dy * at.h) < 2) {
        el.forEach((n) => ((n as HTMLElement).style.translate = ""));
        return;
      }
      const after = { ...moveMark(hit, dx, dy), updatedAt: Date.now() };
      this.actions.update(after);
      this.record([{ before: hit, after }]);
    });
  }

  // ---------- Metin kutusu ve yapışkan not ----------

  private createText(at: NonNullable<ReturnType<WriteMode["pageAt"]>>, kind: "text" | "sticky"): void {
    const now = Date.now();
    const width = kind === "sticky" ? 0.26 : 0.32;
    const x = Math.min(at.x, 1 - width);
    const m: Mark = kind === "text"
      ? { id: uid(), fileHash: this.fileHash, page: at.page, kind: "text", color: this.color, box: [x, at.y, width, 0.03], text: "", createdAt: now, updatedAt: now }
      : { id: uid(), fileHash: this.fileHash, page: at.page, kind: "sticky", box: [x, at.y, width, 0.08], text: "", createdAt: now, updatedAt: now };
    this.actions.add(m);
    this.edit(m.id, true);
  }

  /** Metni yerinde düzenle. `Esc` bitirir; boş kalan kutu kendiliğinden silinir. */
  edit(id: string, isNew = false): void {
    const m = this.find(id);
    if (!m || (m.kind !== "text" && m.kind !== "sticky")) return;
    if (m.kind === "sticky" && m.collapsed) this.actions.update({ ...m, collapsed: false });
    this.select(id);
    const host = this.viewer.root.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    const el = m.kind === "sticky" ? host?.querySelector<HTMLElement>(".cm-sticky__text") : host;
    if (!el) return;
    this.editingId = id;
    el.contentEditable = "plaintext-only";
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-multiline", "true");
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);

    const before = m;
    const finish = () => {
      el.removeEventListener("blur", finish);
      el.removeEventListener("keydown", onKey);
      if (this.editingId !== id) return;
      this.editingId = null;
      const text = el.innerText.replace(/\n+$/, "").trim();
      const pageEl = this.viewer.pageElement(m.page);
      const hgt = pageEl ? (host!.offsetHeight / pageEl.clientHeight) : before.box[3];
      if (!text) {
        this.actions.remove(id);
        if (!isNew) this.record([{ remove: before }]);
        return;
      }
      const after = { ...before, text, box: [before.box[0], before.box[1], before.box[2], hgt], updatedAt: Date.now() } as Mark;
      this.actions.update(after);
      this.record([isNew ? { add: after } : { before, after }]);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        el.blur();
      }
    };
    el.addEventListener("blur", finish);
    el.addEventListener("keydown", onKey);
  }

  finishEditing(): void {
    if (!this.editingId) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
}

function ellipsePath(x0: number, y0: number, x1: number, y1: number): string {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  return `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
}

