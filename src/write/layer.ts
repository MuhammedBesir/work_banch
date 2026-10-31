import type { InkColor, Mark } from "../types";
import { h } from "../util";
import { isCustom } from "./colors";
import { arrowHead, inkPressures, penStyle, smoothPath, straightPath, strokeOutline } from "./geometry";
import { renderRich } from "./rich";

const SVG = "http://www.w3.org/2000/svg";

/** Yapışkan notun türü: AI notu, sayfa notu (metne bağlı olmayan, taranmış sayfalar için) ya da yapışkan not. */
export const stickyLabel = (m: { ai?: boolean; pageNote?: boolean }) => (m.ai ? "AI notu" : m.pageNote ? "Sayfa notu" : "Yapışkan not");

export const PEN_LABEL = { black: "Siyah", blue: "Mavi", red: "Kırmızı" } as const;
export const PEN_KIND_LABEL = { pen: "Tükenmez", pencil: "Kurşun kalem", marker: "Fosforlu", fountain: "Dolma kalem" } as const;

export const colorLabel = (c: InkColor) => (isCustom(c) ? `Özel renk ${c}` : PEN_LABEL[c]);

/** Renk sınıfı ve (özel renkte) değişkeni. */
export const colorClass = (c: InkColor) => (isCustom(c) ? "custom" : c);
const colorVar = (el: Element, c: InkColor) => {
  if (isCustom(c)) (el as SVGElement | HTMLElement).style.setProperty("--c", c);
};

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Kalem kalınlığı ekranda zoom ile birlikte büyür: `--z` görüntüleyicinin ölçeği. */
const strokeStyle = (width: number) => `stroke-width:calc(${width}px * var(--z, 1))`;

export interface LayerOptions {
  editable: boolean;
  selected: ReadonlySet<string>;
  /** Görüntüleyicinin ölçeği: basınçlı çizginin kalınlığı sayfa birimine çevrilir. */
  scale: number;
  onSticky?(id: string, collapsed: boolean): void;
  /** Notun içindeki yapılacak kutusu işaretlendi. */
  onToggle?(id: string, line: number): void;
}

/**
 * Kalem ve şekil çizimleri tek bir SVG'de (viewBox 0–1). Basınç kaydı olan kalem çizgisi
 * kalınlığı boyunca değişen dolu bir şekil, diğerleri ölçekten bağımsız çizgi.
 * `w`, `h` sayfanın ölçek 1'deki boyutu; küçük sayfa önizlemesi de aynı çizimi kullanır.
 */
export function drawingsSvg(marks: Mark[], w: number, h: number, selected: ReadonlySet<string> = new Set()): SVGSVGElement {
  const root = svg("svg", { class: "cm-ink", viewBox: "0 0 1 1", preserveAspectRatio: "none", "aria-hidden": "true" });
  const aspect = h / Math.max(1, w);
  // Resimler en altta, çizimler üstte.
  for (const m of marks) {
    if (m.kind !== "image") continue;
    const [x, y, iw, ih] = m.box;
    root.append(svg("image", { href: m.src, x, y, width: iw, height: ih, preserveAspectRatio: "none", class: `cm-image${selected.has(m.id) ? " is-selected" : ""}`, "data-id": m.id }));
  }
  for (const m of marks) {
    const sel = selected.has(m.id) ? " is-selected" : "";
    if (m.kind === "ink") {
      const pen = m.pen ?? "pen";
      const style = penStyle(pen, m.width);
      const kind = pen === "pen" ? "" : ` cm-stroke--${pen}`;
      const pressures = inkPressures(m, w, h);
      let p: SVGPathElement;
      if (pressures) {
        p = svg("path", { d: strokeOutline(m.points, pressures, style.width, w, h), class: `cm-stroke cm-stroke--fill cm-stroke--${colorClass(m.color)}${kind}${sel}`, "data-id": m.id });
      } else {
        p = svg("path", { d: m.straight ? straightPath(m.points) : smoothPath(m.points), class: `cm-stroke cm-stroke--${colorClass(m.color)}${kind}${sel}`, "data-id": m.id });
        p.setAttribute("style", strokeStyle(style.width));
      }
      colorVar(p, m.color);
      root.append(p);
    } else if (m.kind === "shape") {
      const [x0, y0] = m.from;
      const [x1, y1] = m.to;
      const g = svg("g", { class: `cm-stroke cm-stroke--${colorClass(m.color)}${sel}`, "data-id": m.id });
      g.setAttribute("style", strokeStyle(m.width));
      colorVar(g, m.color);
      if (m.shape === "rect") {
        g.append(svg("rect", { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }));
      } else if (m.shape === "ellipse") {
        g.append(svg("ellipse", { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: Math.abs(x1 - x0) / 2, ry: Math.abs(y1 - y0) / 2 }));
      } else {
        const [a, b] = arrowHead(m.from, m.to, aspect);
        g.append(svg("path", { d: `M${x0} ${y0} L${x1} ${y1} M${a[0]} ${a[1]} L${x1} ${y1} L${b[0]} ${b[1]}` }));
      }
      root.append(g);
    }
  }
  return root;
}

/**
 * Bir sayfanın Yaz modu katmanı. Çizimler SVG'de, metin kutuları ve yapışkan notlar
 * yüzde ile konumlanmış HTML. Zoom'da bozulmaz, yeniden çizilmez.
 */
export function renderMarks(pageEl: HTMLElement, page: number, marks: Mark[], o: LayerOptions): HTMLElement {
  let layer = pageEl.querySelector<HTMLElement>(":scope > .cm-page__marks");
  if (!layer) {
    layer = h("div", { class: "cm-page__marks" });
    pageEl.append(layer);
  }
  const frag = document.createDocumentFragment();
  frag.append(drawingsSvg(marks, pageEl.clientWidth / o.scale, pageEl.clientHeight / o.scale, o.selected));

  for (const m of marks) {
    const selected = o.selected.has(m.id);
    if (m.kind === "text") {
      const [x, y, w] = m.box;
      const box = h("div", {
        class: `cm-textbox cm-rich cm-textbox--${colorClass(m.color)}${selected ? " is-selected" : ""}`,
        "data-id": m.id,
        role: "note",
        "aria-label": `Metin kutusu, sayfa ${page + 1}`,
      }, renderRich(m.text, o.onToggle && ((line) => o.onToggle!(m.id, line))));
      box.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%${m.size ? `;--fs:${m.size}px` : ""}`;
      colorVar(box, m.color);
      // Seçiliyken sağ kenardaki tutamaçla genişlik değişir.
      if (selected && o.editable) box.append(h("span", { class: "cm-textbox__handle", "data-handle": m.id, "aria-hidden": "true" }));
      frag.append(box);
    } else if (m.kind === "sticky") {
      const [x, y, w] = m.box;
      const toggle = h("button", {
        class: "cm-sticky__toggle",
        "aria-label": m.collapsed ? "Yapışkan notu aç" : "Yapışkan notu daralt",
        "aria-expanded": String(!m.collapsed),
        onclick: (e: Event) => (e.stopPropagation(), o.onSticky?.(m.id, !m.collapsed)),
      }, m.collapsed ? "" : "–");
      const note = h("div", {
        class: `cm-sticky${m.tint && m.tint !== "yellow" ? ` cm-sticky--${m.tint}` : ""}${m.collapsed ? " is-collapsed" : ""}${selected ? " is-selected" : ""}${m.ai ? " is-ai" : ""}`,
        "data-id": m.id,
        role: "note",
        "aria-label": `${stickyLabel(m)}, sayfa ${page + 1}`,
      },
        toggle,
        m.collapsed ? null : h("small", { text: `${stickyLabel(m)} · s. ${page + 1}` }),
        m.collapsed ? null : h("div", { class: "cm-sticky__text cm-rich" }, renderRich(m.text, o.onToggle && ((line) => o.onToggle!(m.id, line)))),
      );
      note.style.cssText = m.collapsed
        ? `left:calc(${(x + w) * 100}% - 16px);top:${y * 100}%`
        : `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%`;
      frag.append(note);
    }
  }
  layer.classList.toggle("is-editable", o.editable);
  layer.replaceChildren(frag);
  return layer;
}
