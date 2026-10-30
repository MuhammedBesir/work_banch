/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";

// Üretim derlemesinde sıkı CSP: üçüncü taraf script yok; tek dış bağlantı (AI açıksa) Anthropic API.
// Geliştirmede Vite'ın HMR bağlantısını bozmamak için eklenmez.
const csp: Plugin = {
  name: "csp",
  apply: "build",
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self' data:",
      // AI açıkken istekler yalnızca kullanıcının kendi anahtarıyla Anthropic API'sine gider.
      "connect-src 'self' blob: data: https://api.anthropic.com",
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
