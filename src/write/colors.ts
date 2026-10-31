import type { InkColor, PenColor } from "../types";

/** Hazır kalem renklerinin basılı karşılığı (PDF ve resim dışa aktarma). */
export const PEN_RGB: Record<PenColor, [number, number, number]> = { black: [0x1f, 0x1d, 0x1a], blue: [0x1f, 0x4e, 0x79], red: [0xa3, 0x22, 0x1a] };

export const isCustom = (c: InkColor): c is `#${string}` => c.startsWith("#");

export function inkRgb(c: InkColor): [number, number, number] {
  if (!isCustom(c)) return PEN_RGB[c] ?? PEN_RGB.black;
  const hex = c.slice(1);
  const full = hex.length === 3 ? [...hex].map((x) => x + x).join("") : hex.padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
}

/** Ekranda: hazır renkler tema değişkeninden (koyu temada açılır), özel renk olduğu gibi. */
export const inkCss = (c: InkColor) => (isCustom(c) ? c : `var(--pen-${c})`);

/** Özel renk seçiminde önerilenler (Samsung Notes'taki palete benzer, okunur tonlar). */
export const SWATCHES = ["#1f1d1a", "#5b5b5b", "#1f4e79", "#2f7ed8", "#0f7b6c", "#3d8b37", "#b8860b", "#d9730d", "#a3221a", "#c2185b", "#6a3ea1", "#8d6e63"];
