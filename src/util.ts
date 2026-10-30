export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const uid = (): string => crypto.randomUUID();

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Küçük DOM yardımcısı: h("div", { class: "x" }, "metin", child) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | undefined> = {},
  ...children: (Node | string | false | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== false && c != null) el.append(c);
  return el;
}

export const kbd = (text: string) => h("span", { class: "cm-kbd", text });

export const marker = (color: number) => h("span", { class: `cm-mk cm-mk--${color}`, "aria-hidden": "true" });

/** Bir girdi alanı odaktayken tek harfli kısayollar çalışmaz. */
export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

let announcer: HTMLElement | null = null;
export function announce(text: string): void {
  announcer ??= document.getElementById("announcer");
  if (!announcer) return;
  announcer.textContent = "";
  requestAnimationFrame(() => (announcer!.textContent = text));
}

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
