// Yaz modu simgeleri: 20×20, çizgi (currentColor). Metin yerine simge; ad ve kısayol ipucunda ve ekran okuyucuda.

const SVG = "http://www.w3.org/2000/svg";

const PATHS: Record<string, string> = {
  select: "M5 3l10 6.2-4.4 1.1L13.3 16l-2 1-2.7-5.6L5 14.7z",
  lasso: "M10 4c4.4 0 7 1.8 7 4s-2.6 4-7 4-7-1.8-7-4 2.6-4 7-4zM6 11.5c-.8.8-1 1.8-.6 2.6.6 1.1 2.2 1.4 3.3.6M8.7 14.7c-.4 1-.2 2 .6 2.8",
  highlight: "M12.5 3.5l4 4-7.5 7.5H5v-4zM10.5 5.5l4 4M3 18h14",
  pen: "M14 3l3 3-9.5 9.5L4 17l1.5-3.5zM12 5l3 3",
  text: "M5 5h10M10 5v11M7.5 16h5",
  sticky: "M4 4h12v8l-4 4H4zM12 16v-4h4",
  shape: "M3.5 10.5h6v6h-6zM14 3.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7z",
  image: "M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13.5 7.5a1 1 0 11-.01 0",
  eraser: "M8 16h9M4.5 12.5l7-7.5 4.5 4.5-6.5 6.5H7.5z M8 9l4.5 4.5",
  undo: "M7 5L3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 010 9H9",
  redo: "M13 5l3.5 3.5L13 12M16 8.5H8a4.5 4.5 0 000 9h3",
  colors: "M10 3a7 7 0 100 14c1 0 1.5-.6 1.5-1.4 0-1.2-1-1.3-1-2.3 0-.8.6-1.3 1.5-1.3H14a3 3 0 003-3C17 5.6 13.9 3 10 3zM6.5 9.5h.01M8.5 6.5h.01M12 6.5h.01",
  // kalem türleri
  "pen-pen": "M14 3l3 3-9.5 9.5L4 17l1.5-3.5z",
  "pen-pencil": "M14 3l3 3-9.5 9.5L4 17l1.5-3.5zM5.5 13.5l1 1M12 5l3 3",
  "pen-marker": "M12 3l5 5-6 6H8l-2-2v-3zM6 12l-3 5h5",
  "pen-fountain": "M10 2.5l4.5 6-4.5 9-4.5-9zM10 8.5v4M10 12.5a.6.6 0 110 .01",
  // şekiller
  "shape-rect": "M4 5h12v10H4z",
  "shape-ellipse": "M10 4c4.4 0 7 2.7 7 6s-2.6 6-7 6-7-2.7-7-6 2.6-6 7-6z",
  "shape-arrow": "M4 16L16 4M9 4h7v7",
  // silgi
  "eraser-partial": "M8 16h9M4.5 12.5l7-7.5 4.5 4.5-6.5 6.5H7.5zM2.5 4.5h3",
  "eraser-stroke": "M8 16h9M4.5 12.5l7-7.5 4.5 4.5-6.5 6.5H7.5zM2 6c2-3 4 0 6-3",
  // seçim çubuğu
  recolor: "M10 3.5S5 9 5 12a5 5 0 0010 0c0-3-5-8.5-5-8.5z",
  straighten: "M3 7c3-3 5 3 8 0s4-2 6-1M3 14h14",
  totext: "M3 6c1.5-2 3 2 4.5 0S10 4 11 5M4 11h5M6.5 11v6M12 14h5m-2-2l2 2-2 2",
  math: "M3 10h3l2 6 3-12h6M12 9l4 5M16 9l-4 5",
  copy: "M7 7h9v9H7zM4 13V4h9",
  trash: "M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11",
  play: "M6 4l10 6-10 6z",
  edit: "M4 16h3.5L16 7.5 12.5 4 4 12.5zM11 5.5l3.5 3.5",
  expand: "M11 3h6v6M9 17H3v-6M17 3l-6 6M3 17l6-6",
  collapse: "M15 9h-4V5M5 11h4v4M11 9l6-6M9 11l-6 6",
  area: "M3 6V3h3M14 3h3v3M17 14v3h-3M6 17H3v-3M7 3h2M11 3h2M7 17h2M11 17h2M3 8v4M17 8v4",
  send: "M3.5 10L16.5 4l-4.5 12.5-2.5-5zM10 11.5l6.5-7.5",
  stop: "M6 6h8v8H6z",
  chev: "M6 8l4 4 4-4",
  doc: "M5 2.5h7l3 3v12H5zM12 2.5v3h3M7.5 9h5M7.5 12h5M7.5 15h3",
  bolt: "M11 2.5L4.5 11h5l-1 6.5 7-9h-5z",
  download: "M10 3v10M6 9l4 4 4-4M4 16.5h12",
  upload: "M10 13V3.5M6 7.5l4-4 4 4M3.5 12.5v4h13v-4",
  notebook: "M5 2.5h10v15H5zM8 2.5v15M10.5 6.5h3M10.5 9.5h3",
  package: "M3 6.5L10 3l7 3.5v7L10 17l-7-3.5zM3 6.5l7 3.5 7-3.5M10 10v7",
  lock: "M5.5 9h9v8h-9zM7.5 9V6.5a2.5 2.5 0 015 0V9",
  rotate: "M15.5 8A6 6 0 104 10M15.5 3.5V8H11",
  crop: "M5 2.5V15h12.5M2.5 5H15v12.5",
  margin: "M3 3.5h14v13H3zM13 3.5v13M14.5 7h1M14.5 10h1M14.5 13h1",
  split: "M4 3.5h7l3 3v10H4zM11 3.5v3h3M7 11h4M9 9v4",
  plus: "M10 4v12M4 10h12",
  merge: "M3 3.5h6v8H3zM11 8.5h6v8h-6zM6 11.5v3h5",
  quiz: "M4 3h12v14H4zM7 7h6M7 10.5h6M7 14h3",
  // üst çubuk
  search: "M8.5 3.5a5 5 0 110 10 5 5 0 010-10zM12.2 12.2L16.5 16.5",
  moon: "M15.5 12.5A6.5 6.5 0 017.5 4.5a6.5 6.5 0 108 8z",
  sun: "M10 6.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4",
  focus: "M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4",
  mic: "M10 2.5a2.5 2.5 0 012.5 2.5v5a2.5 2.5 0 01-5 0V5A2.5 2.5 0 0110 2.5zM5 9.5a5 5 0 0010 0M10 14.5V17.5",
  sparkle: "M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  panel: "M3 4h14v12H3zM12.5 4v12",
  rail: "M3 4h14v12H3zM7.5 4v12",
  export: "M10 3v9M6.5 6.5L10 3l3.5 3.5M4 11v5h12v-5",
};

export function icon(name: keyof typeof PATHS | string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("cm-icon");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", PATHS[name] ?? "");
  svg.append(p);
  return svg;
}
