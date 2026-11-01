/// <reference types="vitest" />
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Üretim derlemesinde sıkı CSP: üçüncü taraf script yok; dış bağlantılar yalnızca AI için (aşağıda).
// Geliştirmede Vite'ın HMR bağlantısını bozmamak için eklenmez.
const csp: Plugin = {
  name: "csp",
  apply: "build",
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      // WebAssembly: OCR (tesseract) ve cihazda model (WebLLM) için.
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      // AI açıkken istekler yalnızca kullanıcının kendi anahtarıyla Anthropic API'sine gider.
      // Dışarıya yalnızca AI açıkken ve kullanıcı sorunca: kendi anahtarıyla Anthropic / OpenAI,
      // bu bilgisayardaki yerel model sunucusu, cihazda model için tek seferlik model indirme.
      "connect-src 'self' blob: data: https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://api.groq.com https://openrouter.ai http://localhost:* http://127.0.0.1:* https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`);
  },
};

// Çevrimdışı çalışma: derlenen uygulama dosyalarının listesiyle service worker üretir.
// 2 MB'tan büyük, isteğe bağlı parçalar (OCR, cihazda model) önceden indirilmez; ilk kullanımda saklanır.
const sw: Plugin = {
  name: "sw",
  apply: "build",
  closeBundle() {
    const out = "dist";
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        // .woff2 yeterli; eski .woff kopyaları ve yalnızca AI açıkken gereken sağlayıcı SDK'ları ilk kullanımda saklanır.
        else if (statSync(p).size < 2 * 1024 * 1024 && !/\.(map|woff|ttf)$/.test(f) && !/KaTeX_/.test(f) && !/^(anthropic|openai)-/.test(f) && f !== "sw.js") files.push(relative(out, p).split("\\").join("/"));
      }
    };
    walk(out);
    const list = ["./", ...files.map((f) => `./${f}`)].sort();
    const version = createHash("sha256").update(list.join("\n")).update(readFileSync(join(out, "index.html"))).digest("hex").slice(0, 12);
    const tpl = readFileSync("scripts/sw-template.js", "utf8");
    writeFileSync(join(out, "sw.js"), tpl.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(list, null, 2)));
  },
};

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev") },
  plugins: [csp, sw],
  build: { target: "es2022" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
