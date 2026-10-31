import type { Viewer } from "../pdf/viewer";
import type { InkColor, Mark, PenKind, ShapeKind } from "../types";
import { PEN_COLORS, PEN_KINDS } from "../types";
import { h, isTyping, kbd, uid } from "../util";
import { SWATCHES, inkCss, isCustom } from "./colors";
import {
  constrain, eraseInk, hitMark, inLasso, inkSlope, moveMark, penStyle, recognizeShape, rotateAround, scaleMark,
  simplifyIndices, straightPath, unionBox, type Recognized,
} from "./geometry";
import { PEN_KIND_LABEL, PEN_LABEL, colorClass, colorLabel } from "./layer";
import { applyFormat } from "./rich";

export type Tool = "select" | "lasso" | "highlight" | "pen" | "text" | "sticky" | "shape" | "image" | "eraser";

const TOOLS: [Tool, string, string][] = [
  ["select", "Seç", "V"],
  ["lasso", "Kement", "L"],
  ["highlight", "Vurgu", "H"],
  ["pen", "Kalem", "P"],
  ["text", "Metin", "T"],
  ["sticky", "Not", "S"],
  ["shape", "Şekil", "R"],
  ["image", "Resim", "I"],
  ["eraser", "Silgi", "E"],
];
const SHAPES: [ShapeKind, string][] = [["rect", "Dikdörtgen"], ["ellipse", "Daire"], ["arrow", "Ok"]];
const WIDTHS = [1, 2, 4];
type EraserMode = "partial" | "stroke";
/** Kalem bu kadar süre yerinde durursa çizilen şekil düzeltilir (çiz ve bekle). */
const HOLD_MS = 550;
const ERASER_PX = 10;

type Op = { add: Mark } | { remove: Mark } | { before: Mark; after: Mark };

export interface WriteActions {
  marks(): Mark[];
  add(m: Mark): void;
  update(m: Mark): void;
  remove(id: string): void;
  /** Sayfanın işaret katmanını yeniden çiz (seçim/araç değişince). */
  redraw(page: number): void;
  pen(p: { color: InkColor; width: number; kind: PenKind; custom: string[] }): void;
  announce(text: string): void;
  /** Seçili el yazısını metne çevir ya da matematiği çöz (kement eylem çubuğu). */
  handwriting?(marks: Mark[], page: number, mode: "text" | "math"): void;
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
  color: InkColor;
  width: number;
  pen: PenKind;
  eraserMode: EraserMode = "partial";
  private custom: string[];
  private colorsOpen = false;
  /** Seçili işaretler (`Shift` + tıklama ile çoklu seçim). */
  readonly selected = new Set<string>();
  editingId: string | null = null;
  private undoStack: Op[][] = [];
  private redoStack: Op[][] = [];
  private active = false;

  constructor(
    private viewer: Viewer,
    private fileHash: string,
    pen: { color: InkColor; width: number; kind?: PenKind; custom?: string[] },
    private actions: WriteActions,
  ) {
    this.color = pen.color;
    this.width = pen.width;
    this.pen = pen.kind ?? "pen";
    this.custom = pen.custom ?? [];
    this.el = h("div", { class: "cm-palette", role: "toolbar", "aria-label": "Yazma araçları", "aria-orientation": "vertical" });
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.renderPalette();
  }

  get selectedId(): string | null {
    return this.selected.values().next().value ?? null;
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
    this.viewer.root.addEventListener("contextmenu", this.onContext);
    document.addEventListener("paste", this.onPaste);
    this.syncOverlay();
  }

  disable(): void {
    this.finishEditing();
    this.active = false;
    this.selected.clear();
    this.paintSelection();
    this.viewer.root.removeEventListener("pointerdown", this.onDown);
    this.viewer.root.removeEventListener("dblclick", this.onDblClick);
    this.viewer.root.removeEventListener("contextmenu", this.onContext);
    document.removeEventListener("paste", this.onPaste);
    this.viewer.root.classList.remove("is-writing", ...TOOLS.map(([t]) => `is-tool-${t}`));
  }

  /** Kalemin yan tuşu sağ tık olarak gelir: menü açılmasın. */
  private onContext = (e: Event) => {
    if ((e as PointerEvent).pointerType === "pen" || this.penButton) e.preventDefault();
  };
  private penButton = false;

  /** Panodan resim yapıştırma (Ctrl V): geçerli sayfanın ortasına. */
  private onPaste = (e: ClipboardEvent) => {
    if (!this.active || this.editingId || isTyping(e as unknown as KeyboardEvent)) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    void this.placeImage(file, this.viewer.current, 0.3, 0.3);
  };

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

  private savePen(): void {
    this.actions.pen({ color: this.color, width: this.width, kind: this.pen, custom: this.custom });
  }

  setColor(c: InkColor): void {
    this.color = c;
    if (isCustom(c) && !this.custom.includes(c)) this.custom = [c, ...this.custom].slice(0, 6);
    this.savePen();
    this.renderPalette();
    if (this.selected.size) this.recolorSelected(c);
  }

  private setWidth(w: number): void {
    this.width = w;
    this.savePen();
    this.renderPalette();
  }

  setPen(k: PenKind): void {
    this.pen = k;
    if (this.tool !== "pen") this.setTool("pen");
    this.savePen();
    this.renderPalette();
    this.actions.announce(PEN_KIND_LABEL[k]);
  }

  private renderPalette(): void {
    const tool = ([t, label, key]: [Tool, string, string]) =>
      h("button", { class: `cm-tool${this.tool === t ? " is-on" : ""}`, "aria-pressed": String(this.tool === t), title: `${label} (${key})`, onclick: () => this.setTool(t) }, label, kbd(key));
    const sub = (on: boolean, label: string, run: () => void) =>
      h("button", { class: `cm-tool cm-tool--sub${on ? " is-on" : ""}`, "aria-pressed": String(on), onclick: run }, label);
    const sep = () => h("div", { class: "cm-palette__sep" });
    const subs = this.tool === "shape"
      ? [sep(), ...SHAPES.map(([s, label]) => sub(this.shape === s, label, () => ((this.shape = s), this.renderPalette())))]
      : this.tool === "pen"
        ? [sep(), ...PEN_KINDS.map((k) => sub(this.pen === k, PEN_KIND_LABEL[k], () => this.setPen(k)))]
        : this.tool === "eraser"
          ? [sep(), sub(this.eraserMode === "partial", "Kısmi", () => ((this.eraserMode = "partial"), this.renderPalette())), sub(this.eraserMode === "stroke", "Bütün çizgi", () => ((this.eraserMode = "stroke"), this.renderPalette()))]
          : [];
    const swatch = (c: InkColor, label: string) => {
      const b = h("button", { class: `cm-pen cm-pen--${colorClass(c)}${this.color === c ? " is-on" : ""}`, "aria-label": label, "aria-pressed": String(this.color === c), title: label, onclick: () => this.setColor(c) });
      if (isCustom(c)) b.style.setProperty("--c", c);
      return b;
    };
    const picker = h("input", { type: "color", class: "cm-colorpick__input", "aria-label": "Özel renk seç", value: isCustom(this.color) ? this.color : "#2f7ed8" });
    picker.addEventListener("change", () => this.setColor(picker.value as InkColor));
    const colors = this.colorsOpen
      ? h("div", { class: "cm-colorpick", role: "group", "aria-label": "Özel renkler" },
          ...SWATCHES.map((c) => swatch(c as InkColor, `Renk ${c}`)),
          h("label", { class: "cm-colorpick__more", title: "Başka renk" }, "+", picker))
      : null;
    this.el.replaceChildren(
      ...TOOLS.map(tool),
      ...subs,
      sep(),
      ...PEN_COLORS.map((c, i) => swatch(c, `${PEN_LABEL[c]} (Shift ${i + 1})`)),
      ...this.custom.filter((c) => !PEN_COLORS.includes(c as never)).slice(0, 4).map((c) => swatch(c as InkColor, `Özel renk ${c}`)),
      h("button", { class: `cm-tool cm-tool--sub${this.colorsOpen ? " is-on" : ""}`, "aria-expanded": String(this.colorsOpen), onclick: () => ((this.colorsOpen = !this.colorsOpen), this.renderPalette()) }, "Renkler"),
      ...(colors ? [colors] : []),
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
    this.paintSelection();
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
    if (e.key === "Escape" && this.selected.size) return this.select(null), true;
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected.size) {
      const list = [...this.selected].map((id) => this.find(id)).filter((m): m is Mark => !!m);
      this.selected.clear();
      list.forEach((m) => this.actions.remove(m.id));
      this.record(list.map((m) => ({ remove: m })));
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

  /** `additive`: Shift + tıklama seçime ekler / çıkarır. */
  private select(id: string | null, additive = false): void {
    const pages = new Set([...this.selected].map((x) => this.find(x)?.page).filter((p): p is number => p !== undefined));
    if (!additive) this.selected.clear();
    if (id) {
      if (additive && this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      const cur = this.find(id);
      if (cur) pages.add(cur.page);
    }
    pages.forEach((p) => this.actions.redraw(p));
    this.paintSelection();
  }

  private recolorSelected(c: InkColor): void {
    const ops: Op[] = [];
    for (const id of this.selected) {
      const m = this.find(id);
      if (!m || m.kind === "sticky" || m.kind === "image") continue;
      const after = { ...m, color: c, updatedAt: Date.now() } as Mark;
      this.actions.update(after);
      ops.push({ before: m, after });
    }
    this.record(ops);
  }

  // ---------- İşaretçi ----------

  private pageAt(e: PointerEvent | MouseEvent): { page: number; el: HTMLElement; x: number; y: number; w: number; h: number } | null {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-page");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { page: Number(el.dataset.page), el, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
  }

  private onDown = (e: PointerEvent) => {
    // Kalemin yan tuşu (sağ tık, 2) ya da silgi ucu (5 / buttons & 32): basılıyken geçici silgi.
    const penEraser = e.pointerType === "pen" && (e.button === 2 || e.button === 5 || (e.buttons & (2 | 32)) !== 0);
    this.penButton = penEraser;
    if ((this.tool === "highlight" && !penEraser) || (e.button > 0 && !penEraser)) return;
    const target = e.target as HTMLElement;
    if (target.closest(".cm-floatwrap, .cm-sticky__toggle, .cm-selbox__bar, .cm-rich__check input, .cm-formatbar")) return;
    if (this.editingId && target.closest("[contenteditable]")) return;
    if (target.dataset.handle) return this.resizeText(e, target.dataset.handle);
    if (target.dataset.scale) return this.scaleSelection(e, target.dataset.scale);
    // Avuç reddi: parmak yalnızca kaydırır.
    if (e.pointerType === "touch") return this.fingerScroll(e);
    const at = this.pageAt(e);
    if (!at) return;
    this.finishEditing();
    e.preventDefault();
    if (penEraser) return this.erase(e, at);
    if (target.closest(".cm-selbox") && (this.tool === "select" || this.tool === "lasso")) return this.dragSelection(e, at);
    switch (this.tool) {
      case "pen": return this.drawInk(e, at);
      case "shape": return this.drawShape(e, at);
      case "eraser": return this.erase(e, at);
      case "text": return this.createText(at, "text");
      case "sticky": return this.createText(at, "sticky");
      case "select": return this.pick(e, at);
      case "lasso": return this.lasso(e, at);
      case "image": return this.chooseImage(at);
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

  private track(e: PointerEvent, el: HTMLElement, onMove: (pts: [number, number, number][], ev: PointerEvent) => void, onUp: () => void): void {
    el.setPointerCapture?.(e.pointerId);
    const box = el.getBoundingClientRect();
    const norm = (ev: PointerEvent): [number, number, number] => [
      Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height)),
      ev.pointerType === "pen" ? ev.pressure : 0.5,
    ];
    onMove([norm(e)], e);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const list = ev.getCoalescedEvents?.() ?? [ev];
      onMove((list.length ? list : [ev]).map(norm), ev);
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
    const pen = this.pen;
    const style = penStyle(pen, this.width);
    path.setAttribute("class", `cm-stroke cm-stroke--${colorClass(this.color)}${pen === "pen" ? "" : ` cm-stroke--${pen}`}`);
    path.setAttribute("style", `stroke-width:calc(${style.width}px * var(--z, 1));--c:${inkCss(this.color)}`);
    live.svg.append(path);
    const pts: [number, number][] = [];
    const pressures: number[] = [];
    let d = "";
    // Çiz ve bekle: kalem yerinde durursa çizilen şekil düzeltilir.
    let hold = 0;
    let anchor: [number, number] | null = null;
    let shaped = null as Recognized | null;
    const arm = () => {
      clearTimeout(hold);
      hold = window.setTimeout(() => {
        if (pen === "marker") return;
        shaped = recognizeShape(pts, at.w, at.h);
        if (!shaped) return;
        path.setAttribute("d", shapePreview(shaped));
        path.classList.add("is-shaped");
        this.actions.announce("Şekil düzeltildi");
      }, HOLD_MS);
    };
    this.track(e, at.el, (list) => {
      if (shaped) return;
      for (const [x, y, p] of list) {
        d += `${pts.length ? " L" : "M"}${x.toFixed(5)} ${y.toFixed(5)}`;
        pts.push([x, y]);
        pressures.push(+p.toFixed(2));
        if (!anchor || Math.hypot((x - anchor[0]) * at.w, (y - anchor[1]) * at.h) > 3) {
          anchor = [x, y];
          arm();
        }
      }
      path.setAttribute("d", d);
    }, () => {
      clearTimeout(hold);
      live.done();
      if (!pts.length) return;
      const now = Date.now();
      const base = { id: uid(), fileHash: this.fileHash, page: at.page, createdAt: now, updatedAt: now };
      let m: Mark;
      const r = shaped as Recognized | null;
      if (r && (r.type === "rect" || r.type === "ellipse")) {
        m = { ...base, kind: "shape", shape: r.type, color: this.color, width: this.width, from: r.from, to: r.to };
      } else if (r && (r.type === "line" || r.type === "poly")) {
        m = { ...base, kind: "ink", color: this.color, width: this.width, points: r.pts, straight: true, ...(pen === "pen" ? {} : { pen }) };
      } else {
        // Kalemle (stylus) çizildiyse her noktanın basıncı saklanır: çizgi boyunca kalınlık değişir.
        const keep = simplifyIndices(pts);
        m = {
          ...base, kind: "ink", color: this.color, width: this.width,
          points: keep.map((i) => pts[i]),
          ...(e.pointerType === "pen" && pen !== "marker" ? { pressures: keep.map((i) => pressures[i]) } : {}),
          ...(pen === "pen" ? {} : { pen }),
        };
      }
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
    this.track(e, at.el, (list, ev) => {
      const [px, py] = list[list.length - 1];
      from ??= [px, py];
      // Shift: kare / daire, ok 45°'lik açılara oturur.
      to = ev.shiftKey ? constrain(from, [px, py], this.shape, at.w, at.h) : [px, py];
      const [x, y] = to;
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

  /**
   * Silgi: "Kısmi" kalem çizgisinin yalnızca değdiği kısmını siler (çizgi parçalara ayrılır),
   * "Bütün çizgi" değdiği işareti tümüyle siler. Şekil, metin ve resim her zaman bütün silinir.
   */
  private erase(e: PointerEvent, at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const ops: Op[] = [];
    const partial = this.eraserMode === "partial";
    const cursor = this.live(at.el);
    const ring = document.createElementNS(SVG, "ellipse");
    ring.setAttribute("class", "cm-eraser-ring");
    ring.setAttribute("rx", String(ERASER_PX / at.w));
    ring.setAttribute("ry", String(ERASER_PX / at.h));
    cursor.svg.append(ring);
    this.track(e, at.el, (list) => {
      for (const [x, y] of list) {
        ring.setAttribute("cx", String(x));
        ring.setAttribute("cy", String(y));
        for (const m of this.actions.marks()) {
          if (m.page !== at.page) continue;
          if (partial && m.kind === "ink" && !m.straight) {
            const pieces = eraseInk(m, x, y, ERASER_PX, at.w, at.h);
            if (!pieces) continue;
            this.actions.remove(m.id);
            ops.push({ remove: m });
            for (const p of pieces) {
              const piece: Mark = { ...m, id: uid(), points: p.points, pressures: p.pressures, updatedAt: Date.now() };
              if (!p.pressures) delete (piece as { pressures?: number[] }).pressures;
              this.actions.add(piece);
              ops.push({ add: piece });
            }
          } else if (hitMark(m, x, y, at.w, at.h, partial ? ERASER_PX : 8)) {
            this.actions.remove(m.id);
            ops.push({ remove: m });
          }
        }
      }
    }, () => {
      cursor.done();
      // Aynı silme içinde eklenip silinen parçalar geri alınca sorun çıkarmasın diye sadeleştir.
      const added = new Set(ops.flatMap((op) => ("add" in op ? [op.add.id] : [])));
      const removedAdded = new Set(ops.flatMap((op) => ("remove" in op && added.has(op.remove.id) ? [op.remove.id] : [])));
      this.record(ops.filter((op) => !("add" in op && removedAdded.has(op.add.id)) && !("remove" in op && removedAdded.has(op.remove.id))));
    });
  }

  // ---------- Kement ve seçim kutusu ----------

  private lasso(e: PointerEvent, at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const live = this.live(at.el);
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("class", "cm-lasso");
    live.svg.append(path);
    const poly: [number, number][] = [];
    this.track(e, at.el, (list) => {
      for (const [x, y] of list) poly.push([x, y]);
      path.setAttribute("d", `${straightPath(poly)} Z`);
    }, () => {
      live.done();
      const hit = poly.length > 2 ? this.actions.marks().filter((m) => m.page === at.page && inLasso(m, poly)) : [];
      this.select(null);
      if (e.shiftKey) hit.forEach((m) => this.selected.add(m.id));
      else hit.forEach((m) => this.selected.add(m.id));
      this.actions.redraw(at.page);
      this.paintSelection();
      this.actions.announce(hit.length ? `${hit.length} işaret seçildi` : "Seçim boş");
    });
  }

  private selectedOn(): { page: number; marks: Mark[] } | null {
    const list = [...this.selected].map((id) => this.find(id)).filter((m): m is Mark => !!m);
    if (!list.length) return null;
    const page = list[0].page;
    return { page, marks: list.filter((m) => m.page === page) };
  }

  /** Seçimin çevresinde kutu, köşelerde boyut tutamaçları ve üstte eylem çubuğu. */
  paintSelection(): void {
    this.viewer.root.querySelectorAll(".cm-selbox").forEach((n) => n.remove());
    if (!this.active || !(this.tool === "select" || this.tool === "lasso")) return;
    const sel = this.selectedOn();
    const pageEl = sel && this.viewer.pageElement(sel.page);
    if (!sel || !pageEl) return;
    // Tek metin kutusu ya da notta kutu gereksiz (kendi tutamacı ve düzenleme var).
    if (sel.marks.length === 1 && (sel.marks[0].kind === "text" || sel.marks[0].kind === "sticky")) return;
    const [x, y, w, hh] = unionBox(sel.marks)!;
    const ink = sel.marks.filter((m) => m.kind === "ink");
    const btn = (label: string, run: () => void, title = label) =>
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", title, onclick: (ev: Event) => (ev.stopPropagation(), run()) }, label);
    const bar = h("div", { class: "cm-selbox__bar", role: "toolbar", "aria-label": "Seçim" },
      h("span", { class: "cm-num cm-selbox__count", text: `${sel.marks.length}` }),
      btn("Renk", () => this.recolorSelected(this.color), `Seçimi ${colorLabel(this.color)} yap`),
      ink.length ? btn("Düzleştir", () => this.straighten()) : null,
      ink.length && this.actions.handwriting ? btn("Metne çevir", () => this.actions.handwriting!(ink, sel.page, "text")) : null,
      ink.length && this.actions.handwriting ? btn("Matematik", () => this.actions.handwriting!(ink, sel.page, "math"), "Matematiği çöz") : null,
      btn("Çoğalt", () => this.duplicate()),
      btn("Sil", () => this.deleteSelected()),
    );
    const box = h("div", { class: "cm-selbox", "aria-hidden": "false" },
      ...["nw", "ne", "sw", "se"].map((c) => h("span", { class: `cm-selbox__h cm-selbox__h--${c}`, "data-scale": c, "aria-hidden": "true" })),
      bar,
    );
    const pad = 0.004;
    box.style.cssText = `left:${(x - pad) * 100}%;top:${(y - pad) * 100}%;width:${(w + pad * 2) * 100}%;height:${(hh + pad * 2) * 100}%`;
    pageEl.append(box);
  }

  private deleteSelected(): void {
    const list = [...this.selected].map((id) => this.find(id)).filter((m): m is Mark => !!m);
    this.selected.clear();
    list.forEach((m) => this.actions.remove(m.id));
    this.record(list.map((m) => ({ remove: m })));
  }

  private duplicate(): void {
    const sel = this.selectedOn();
    if (!sel) return;
    const now = Date.now();
    const copies = sel.marks.map((m) => ({ ...moveMark(m, 0.02, 0.02), id: uid(), createdAt: now, updatedAt: now }) as Mark);
    copies.forEach((m) => this.actions.add(m));
    this.selected.clear();
    copies.forEach((m) => this.selected.add(m.id));
    this.actions.redraw(sel.page);
    this.record(copies.map((m) => ({ add: m })));
  }

  /** El yazısını düzleştir: çizgilerin genel eğimi sıfırlanır (seçimin ortası etrafında döner). */
  private straighten(): void {
    const sel = this.selectedOn();
    const pageEl = sel && this.viewer.pageElement(sel.page);
    if (!sel || !pageEl) return;
    const w = pageEl.clientWidth;
    const hh = pageEl.clientHeight;
    const ang = inkSlope(sel.marks, w, hh);
    if (Math.abs(ang) < 0.008) {
      this.actions.announce("Yazı zaten düz");
      return;
    }
    const [x, y, bw, bh] = unionBox(sel.marks)!;
    const ops: Op[] = sel.marks.map((m) => ({ before: m, after: { ...rotateAround(m, x + bw / 2, y + bh / 2, -ang, w, hh), updatedAt: Date.now() } }));
    ops.forEach((op) => "after" in op && this.actions.update(op.after));
    this.record(ops);
    this.actions.announce("Yazı düzleştirildi");
  }

  private dragSelection(e: PointerEvent, at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const sel = this.selectedOn();
    if (!sel || sel.page !== at.page) return;
    const start: [number, number] = [at.x, at.y];
    let last = start;
    const nodes = [
      ...sel.marks.flatMap((m) => [...this.viewer.root.querySelectorAll<HTMLElement>(`[data-id="${CSS.escape(m.id)}"]`)]),
      ...this.viewer.root.querySelectorAll<HTMLElement>(".cm-selbox"),
    ];
    this.track(e, at.el, (list) => {
      const [x, y] = list[list.length - 1];
      last = [x, y];
      nodes.forEach((n) => (n.style.translate = `${(x - start[0]) * at.w}px ${(y - start[1]) * at.h}px`));
    }, () => {
      nodes.forEach((n) => (n.style.translate = ""));
      const dx = last[0] - start[0];
      const dy = last[1] - start[1];
      if (Math.abs(dx * at.w) < 2 && Math.abs(dy * at.h) < 2) return;
      const ops: Op[] = sel.marks.map((m) => ({ before: m, after: { ...moveMark(m, dx, dy), updatedAt: Date.now() } }));
      ops.forEach((op) => "after" in op && this.actions.update(op.after));
      this.record(ops);
    });
  }

  /** Köşe tutamacı: karşı köşeye göre ölçekle (Shift: oran korunur; resimde her zaman). */
  private scaleSelection(e: PointerEvent, corner: string): void {
    const sel = this.selectedOn();
    const pageEl = sel && this.viewer.pageElement(sel.page);
    if (!sel || !pageEl) return;
    e.preventDefault();
    const [x, y, w, hh] = unionBox(sel.marks)!;
    const ox = corner.includes("w") ? x + w : x;
    const oy = corner.includes("n") ? y + hh : y;
    const keepRatio = sel.marks.every((m) => m.kind === "image");
    let sx = 1;
    let sy = 1;
    const box = this.viewer.root.querySelector<HTMLElement>(".cm-selbox");
    // Önizleme: SVG çizimler sayfa biriminde, HTML kutular kendi köşelerine göre ölçeklenir.
    const nodes = sel.marks.flatMap((m) => [...this.viewer.root.querySelectorAll<SVGElement | HTMLElement>(`[data-id="${CSS.escape(m.id)}"]`)].map((n) => ({ n, m })));
    const r = pageEl.getBoundingClientRect();
    this.track(e, pageEl, (list, ev) => {
      const [px, py] = list[list.length - 1];
      sx = Math.max(0.1, Math.abs(px - ox) / (w || 0.001));
      sy = Math.max(0.1, Math.abs(py - oy) / (hh || 0.001));
      if (keepRatio || ev.shiftKey) sx = sy = Math.max(sx, sy);
      for (const { n, m } of nodes) {
        const st = (n as HTMLElement).style;
        if (n instanceof SVGElement) {
          st.transformBox = "view-box";
          st.transformOrigin = `${ox}px ${oy}px`;
        } else {
          const [bx, by] = "box" in m ? m.box : [0, 0];
          st.transformOrigin = `${(ox - bx) * r.width}px ${(oy - by) * r.height}px`;
        }
        st.transform = `scale(${sx}, ${sy})`;
      }
      if (box) box.style.opacity = "0.4";
    }, () => {
      for (const { n } of nodes) (n as HTMLElement).style.transform = "";
      if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return this.paintSelection();
      const ops: Op[] = sel.marks.map((m) => ({ before: m, after: { ...scaleMark(m, ox, oy, sx, sy), updatedAt: Date.now() } }));
      ops.forEach((op) => "after" in op && this.actions.update(op.after));
      this.record(ops);
    });
  }

  // ---------- Resim ----------

  private chooseImage(at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const input = h("input", { type: "file", accept: "image/*" });
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) void this.placeImage(f, at.page, at.x, at.y);
    });
    input.click();
  }

  /** Resmi küçült (en uzun kenar 1600 px), sayfaya yerleştir ve seç. */
  async placeImage(file: Blob, page: number, x: number, y: number): Promise<void> {
    const pageEl = this.viewer.pageElement(page);
    if (!pageEl) return;
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      this.actions.announce("Bu resim açılamadı");
      return;
    }
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const png = file.type === "image/png" && c.width * c.height < 600_000;
    const src = c.toDataURL(png ? "image/png" : "image/jpeg", 0.86);
    const pw = pageEl.clientWidth;
    const ph = pageEl.clientHeight;
    const w = Math.min(0.5, (bmp.width / pw) * 0.8);
    const hh = (w * pw * (bmp.height / bmp.width)) / ph;
    const now = Date.now();
    const m: Mark = {
      id: uid(), fileHash: this.fileHash, page, kind: "image", src, alt: (file as File).name ?? "Resim",
      box: [Math.min(Math.max(0, x), 1 - w), Math.min(Math.max(0, y), Math.max(0, 1 - hh)), w, hh], createdAt: now, updatedAt: now,
    };
    this.actions.add(m);
    this.record([{ add: m }]);
    if (this.tool !== "select" && this.tool !== "lasso") this.setTool("select");
    this.select(m.id);
    this.actions.announce("Resim eklendi");
  }

  private pick(e: PointerEvent, at: NonNullable<ReturnType<WriteMode["pageAt"]>>): void {
    const hit = [...this.actions.marks()].reverse().find((m) => m.page === at.page && hitMark(m, at.x, at.y, at.w, at.h));
    if (e.shiftKey) {
      if (hit) this.select(hit.id, true);
      return;
    }
    if (!hit || !this.selected.has(hit.id)) this.select(hit?.id ?? null);
    if (!hit) return;
    // Sürükleyerek taşı: seçili işaretlerin hepsi (aynı sayfadakiler) birlikte gider.
    const moving = [...this.selected].map((id) => this.find(id)).filter((m): m is Mark => !!m && m.page === at.page);
    const start: [number, number] = [at.x, at.y];
    let last: [number, number] = start;
    const el = moving.flatMap((m) => [...this.viewer.root.querySelectorAll<Element>(`[data-id="${CSS.escape(m.id)}"]`)]);
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
      const ops: Op[] = moving.map((m) => ({ before: m, after: { ...moveMark(m, dx, dy), updatedAt: Date.now() } }));
      ops.forEach((op) => "after" in op && this.actions.update(op.after));
      this.record(ops);
    });
  }

  /** Metin kutusunun sağ kenarındaki tutamaç: genişliği sürükleyerek değiştir. */
  private resizeText(e: PointerEvent, id: string): void {
    const m = this.find(id);
    const pageEl = m && this.viewer.pageElement(m.page);
    if (!m || m.kind !== "text" || !pageEl) return;
    e.preventDefault();
    const box = pageEl.getBoundingClientRect();
    const node = this.viewer.root.querySelector<HTMLElement>(`.cm-textbox[data-id="${CSS.escape(id)}"]`);
    let width = m.box[2];
    this.track(e, pageEl, (list) => {
      const [x] = list[list.length - 1];
      width = Math.min(1 - m.box[0], Math.max(40 / box.width, x - m.box[0]));
      if (node) node.style.width = `${width * 100}%`;
    }, () => {
      if (Math.abs(width - m.box[2]) < 0.002) return;
      const hgt = node ? node.offsetHeight / pageEl.clientHeight : m.box[3];
      const after = { ...m, box: [m.box[0], m.box[1], width, hgt], updatedAt: Date.now() } as Mark;
      this.actions.update(after);
      this.record([{ before: m, after }]);
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
    // Düzenlerken ham metin (biçim işaretleriyle) görünür.
    el.textContent = m.text;
    el.spellcheck = true;
    el.lang = "tr";
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
    // Biçim çubuğu: kalın, italik, altı çizili, üstü çizili, madde, sıralı, yapılacak, başlık, tablo.
    const fmt = (label: string, kind: Parameters<typeof applyFormat>[1], title: string) =>
      h("button", { class: "cm-formatbar__btn", title, "aria-label": title, onpointerdown: (ev: Event) => ev.preventDefault(), onclick: () => applyFormat(el, kind) }, label);
    const bar = h("div", { class: "cm-formatbar", role: "toolbar", "aria-label": "Biçim" },
      fmt("B", "bold", "Kalın (Ctrl B)"), fmt("I", "italic", "İtalik (Ctrl I)"), fmt("U", "underline", "Altı çizili (Ctrl U)"), fmt("S", "strike", "Üstü çizili"),
      fmt("•", "bullet", "Madde işareti"), fmt("1.", "number", "Sıralı liste"), fmt("☐", "check", "Yapılacak"), fmt("H", "heading", "Başlık"), fmt("▦", "table", "Tablo"));
    // Çubuk kutunun dışında (kutunun metnine karışmasın), sol üst köşesinin hemen üstünde.
    bar.style.left = host!.style.left;
    bar.style.top = host!.style.top;
    host!.parentElement?.append(bar);
    const fmtKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const kind = k === "b" ? "bold" : k === "i" ? "italic" : k === "u" ? "underline" : null;
      if (kind) {
        e.preventDefault();
        applyFormat(el, kind);
      }
    };
    el.addEventListener("keydown", fmtKey);
    el.addEventListener("blur", () => {
      bar.remove();
      el.removeEventListener("keydown", fmtKey);
    }, { once: true });
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


/** Tanınan şeklin önizlemesi (0–1 koordinat). */
function shapePreview(r: NonNullable<ReturnType<typeof recognizeShape>>): string {
  if (r.type === "line" || r.type === "poly") return straightPath(r.pts);
  const [x0, y0] = r.from;
  const [x1, y1] = r.to;
  return r.type === "rect" ? `M${x0} ${y0} H${x1} V${y1} H${x0} Z` : ellipsePath(x0, y0, x1, y1);
}
