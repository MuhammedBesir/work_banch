import { h, kbd } from "../util";

let host: HTMLElement | null = null;

export interface ToastAction {
  label: string;
  shortcut?: string;
  run(): void;
}

/** Kısa bildirim. Eylemli bildirim (Geri al) varsayılan 6 sn kalır. */
export function toast(text: string, action?: ToastAction, ms = action ? 6000 : 2400): () => void {
  host ??= document.body.appendChild(h("div", { class: "cm-toasts", role: "status", "aria-live": "polite" }));
  const el = h("div", { class: "cm-toast" }, h("span", { text }));
  const close = () => el.remove();
  if (action) {
    const btn = h("button", { class: "cm-btn cm-btn--sm cm-btn--ghost", onclick: () => (action.run(), close()) }, action.label);
    if (action.shortcut) btn.append(" ", kbd(action.shortcut));
    el.append(btn);
  }
  host.append(el);
  const timer = setTimeout(close, ms);
  return () => (clearTimeout(timer), close());
}
