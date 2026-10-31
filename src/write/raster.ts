import type { Mark, Rect } from "../types";

/**
 * Kalem çizgilerini beyaz zemine siyah olarak çiz (el yazısı tanıma ve AI'ya gönderilecek görsel).
 * `region` 0–1 (null: bütün sayfa); `pageW`, `pageH` sayfanın ölçek 1'deki boyutu.
 */
export function rasterInk(marks: Mark[], pageW: number, pageH: number, region: Rect | null, maxSide = 1200): HTMLCanvasElement {
  const pad = region ? 0.015 : 0;
  const [rx, ry, rw, rh] = region
    ? [Math.max(0, region[0] - pad), Math.max(0, region[1] - pad), Math.min(1, region[2] + pad * 2), Math.min(1, region[3] + pad * 2)]
    : [0, 0, 1, 1];
  const wPt = Math.max(1, rw * pageW);
  const hPt = Math.max(1, rh * pageH);
  // Küçük bölgeler büyütülür (tanıma için harf yüksekliği önemli), büyükler sınırlanır.
  const k = Math.min(maxSide / Math.max(wPt, hPt), 3);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(wPt * k);
  canvas.height = Math.round(hPt * k);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#000";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const px = ([x, y]: [number, number]): [number, number] => [((x - rx) / rw) * canvas.width, ((y - ry) / rh) * canvas.height];
  for (const m of marks) {
    if (m.kind !== "ink" && m.kind !== "shape") continue;
    ctx.lineWidth = Math.max(2.5, m.width * k * 0.9);
    ctx.beginPath();
    if (m.kind === "shape") {
      const [a, b] = [px(m.from), px(m.to)];
      if (m.shape === "rect") ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      else if (m.shape === "ellipse") ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      else {
        ctx.moveTo(...a);
        ctx.lineTo(...b);
      }
    } else {
      const pts = m.points.map(px);
      ctx.moveTo(...pts[0]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
      if (m.straight || pts.length < 3) pts.slice(1).forEach((p) => ctx.lineTo(...p));
      else {
        for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
        ctx.lineTo(...pts[pts.length - 1]);
      }
    }
    ctx.stroke();
  }
  return canvas;
}

export const canvasBase64 = (c: HTMLCanvasElement) => c.toDataURL("image/png").split(",")[1];
