import type { Mark } from "../types";
import { h } from "../util";
import { arrowHead, smoothPath, strokeOutline } from "./geometry";

const SVG = "http://www.w3.org/2000/svg";

/** Yapışkan notun türü: AI notu, sayfa notu (metne bağlı olmayan, taranmış sayfalar için) ya da yapışkan not. */
export const stickyLabel = (m: { ai?: boolean; pageNote?: boolean }) => (m.ai ? "AI notu" : m.pageNote ? "Sayfa notu" : "Yapışkan not");

export const PEN_LABEL = { black: "Siyah", blue: "Mavi", red: "Kırmızı" } as const;

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
}

/**
 * Kalem ve şekil çizimleri tek bir SVG'de (viewBox 0–1). Basınç kaydı olan kalem çizgisi
 * kalınlığı boyunca değişen dolu bir şekil, diğerleri ölçekten bağımsız çizgi.
 * `w`, `h` sayfanın ölçek 1'deki boyutu; küçük sayfa önizlemesi de aynı çizimi kullanır.
 */
export function drawingsSvg(marks: Mark[], w: number, h: number, selected: ReadonlySet<string> = new Set()): SVGSVGElement {
  const root = svg("svg", { class: "cm-ink", viewBox: "0 0 1 1", preserveAspectRatio: "none", "aria-hidden": "true" });
  const aspect = h / Math.max(1, w);
  for (const m of marks) {
    const sel = selected.has(m.id) ? " is-selected" : "";
    if (m.kind === "ink") {
      if (m.pressures?.length === m.points.length && m.points.length > 1) {
        const p = svg("path", { d: strokeOutline(m.points, m.pressures, m.width, w, h), class: `cm-stroke cm-stroke--fill cm-stroke--${m.color}${sel}`, "data-id": m.id });
        root.append(p);
      } else {
        const p = svg("path", { d: smoothPath(m.points), class: `cm-stroke cm-stroke--${m.color}${sel}`, "data-id": m.id });
        p.setAttribute("style", strokeStyle(m.width));
        root.append(p);
      }
    } else if (m.kind === "shape") {
      const [x0, y0] = m.from;
      const [x1, y1] = m.to;
      const g = svg("g", { class: `cm-stroke cm-stroke--${m.color}${sel}`, "data-id": m.id });
      g.setAttribute("style", strokeStyle(m.width));
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
        class: `cm-textbox cm-textbox--${m.color}${selected ? " is-selected" : ""}`,
        "data-id": m.id,
        role: "note",
        "aria-label": `Metin kutusu, sayfa ${page + 1}`,
        text: m.text,
      });
      box.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%`;
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
        class: `cm-sticky${m.collapsed ? " is-collapsed" : ""}${selected ? " is-selected" : ""}${m.ai ? " is-ai" : ""}`,
        "data-id": m.id,
        role: "note",
        "aria-label": `${stickyLabel(m)}, sayfa ${page + 1}`,
      },
        toggle,
        m.collapsed ? null : h("small", { text: `${stickyLabel(m)} · s. ${page + 1}` }),
        m.collapsed ? null : h("div", { class: "cm-sticky__text", text: m.text }),
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
