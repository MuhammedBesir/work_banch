import type { Mark } from "../types";
import { h } from "../util";
import { arrowHead, smoothPath } from "./geometry";

const SVG = "http://www.w3.org/2000/svg";

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
  selectedId: string | null;
  onSticky?(id: string, collapsed: boolean): void;
}

/**
 * Bir sayfanın Yaz modu katmanı. Çizimler tek bir SVG'de (viewBox 0–1, ölçekten bağımsız çizgi),
 * metin kutuları ve yapışkan notlar yüzde ile konumlanmış HTML. Zoom'da bozulmaz, yeniden çizilmez.
 */
export function renderMarks(pageEl: HTMLElement, page: number, marks: Mark[], o: LayerOptions): HTMLElement {
  let layer = pageEl.querySelector<HTMLElement>(":scope > .cm-page__marks");
  if (!layer) {
    layer = h("div", { class: "cm-page__marks" });
    pageEl.append(layer);
  }
  const aspect = pageEl.clientHeight / Math.max(1, pageEl.clientWidth);
  const root = svg("svg", { class: "cm-ink", viewBox: "0 0 1 1", preserveAspectRatio: "none", "aria-hidden": "true" });
  const frag = document.createDocumentFragment();
  frag.append(root);

  for (const m of marks) {
    const selected = o.selectedId === m.id;
    if (m.kind === "ink") {
      const p = svg("path", { d: smoothPath(m.points), class: `cm-stroke cm-stroke--${m.color}${selected ? " is-selected" : ""}`, "data-id": m.id });
      p.setAttribute("style", strokeStyle(m.width));
      root.append(p);
    } else if (m.kind === "shape") {
      const [x0, y0] = m.from;
      const [x1, y1] = m.to;
      const g = svg("g", { class: `cm-stroke cm-stroke--${m.color}${selected ? " is-selected" : ""}`, "data-id": m.id });
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
    } else if (m.kind === "text") {
      const [x, y, w] = m.box;
      const box = h("div", {
        class: `cm-textbox cm-textbox--${m.color}${selected ? " is-selected" : ""}`,
        "data-id": m.id,
        role: "note",
        "aria-label": `Metin kutusu, sayfa ${page + 1}`,
        text: m.text,
      });
      box.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%`;
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
        "aria-label": `${m.ai ? "AI notu" : "Yapışkan not"}, sayfa ${page + 1}`,
      },
        toggle,
        m.collapsed ? null : h("small", { text: `${m.ai ? "AI notu" : "Yapışkan not"} · s. ${page + 1}` }),
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
