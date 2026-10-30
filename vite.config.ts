/// <reference types="vitest" />
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
      "font-src 'self' data:",
      // AI açıkken istekler yalnızca kullanıcının kendi anahtarıyla Anthropic API'sine gider.
      // Dışarıya yalnızca AI açıkken ve kullanıcı sorunca: kendi anahtarıyla Anthropic / OpenAI,
      // bu bilgisayardaki yerel model sunucusu, cihazda model için tek seferlik model indirme.
      "connect-src 'self' blob: data: https://api.anthropic.com https://api.openai.com http://localhost:* http://127.0.0.1:* https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`);
  },
};

export default defineConfig({
  base: "./",
  plugins: [csp],
  build: { target: "es2022" },
  test: { environment: "node" },
});
