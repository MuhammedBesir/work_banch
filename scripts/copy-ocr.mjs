// OCR dosyalarını (tesseract işçisi, wasm çekirdeği, Türkçe ve İngilizce dil verisi) public/ocr altına kopyalar:
// tarayıcıda OCR kendi sunucumuzdan yüklenir, hiçbir CDN'e istek gitmez.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = root + "public/ocr/";
const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/tur/4.0.0_best_int/tur.traineddata.gz", "lang/tur.traineddata.gz"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "lang/eng.traineddata.gz"],
];
for (const d of ["", "core", "lang"]) mkdirSync(out + d, { recursive: true });
for (const [from, to] of files) {
  if (!existsSync(out + to)) copyFileSync(root + from, out + to);
}
console.log("OCR dosyaları hazır");
