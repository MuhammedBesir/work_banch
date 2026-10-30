import { h, kbd } from "../util";

export interface DialogHandle {
  el: HTMLDivElement;
  body: HTMLDivElement;
  foot: HTMLDivElement;
  close(): void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Kenarlı pencere: perde, odak tuzağı, Esc ile kapanır, kapanınca odak geri döner. */
export function openDialog(opts: {
  title: string;
  width?: number;
  role?: "dialog" | "alertdialog";
  closable?: boolean;
  onClose?(): void;
}): DialogHandle {
  const previous = document.activeElement as HTMLElement | null;
  const id = `dlg-${Math.random().toString(36).slice(2)}`;
  const body = h("div", { class: "cm-dialog__body" });
  const foot = h("div", { class: "cm-dialog__foot" });
  const head = h("div", { class: "cm-dialog__head" }, h("h2", { class: "cm-dialog__title", id, text: opts.title }));
  const el = h("div", { class: "cm-dialog", role: opts.role ?? "dialog", "aria-modal": "true", "aria-labelledby": id }, head, body, foot);
  el.style.width = `${opts.width ?? 520}px`;
  const scrim = h("div", { class: "cm-scrim cm" }, el);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scrim.remove();
    document.removeEventListener("keydown", onKey, true);
    opts.onClose?.();
    previous?.focus?.();
  };
  if (opts.closable !== false) {
    head.append(h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-label": "Kapat (Esc)", onclick: close }, "Kapat ", kbd("Esc")));
    scrim.addEventListener("mousedown", (e) => e.target === scrim && close());
  }
  const onKey = (e: KeyboardEvent) => {
    if (!scrim.isConnected) return;
    if (e.key === "Escape" && opts.closable !== false) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    }
    e.stopPropagation();
  };
  document.addEventListener("keydown", onKey, true);
  document.body.append(scrim);
  requestAnimationFrame(() => {
    const auto = el.querySelector<HTMLElement>("[autofocus]") ?? body.querySelector<HTMLElement>(FOCUSABLE) ?? el.querySelector<HTMLElement>(FOCUSABLE);
    auto?.focus();
  });
  return { el, body, foot, close };
}

/** Evet/hayır sorusu. */
export function confirmDialog(o: { title: string; text: string | Node; ok: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const d = openDialog({ title: o.title, role: "alertdialog", onClose: () => resolve(answer) });
    d.body.append(typeof o.text === "string" ? h("p", { style: "margin:0", text: o.text }) : o.text);
    const ok = h("button", { class: `cm-btn ${o.danger ? "cm-btn--danger" : "cm-btn--primary"}`, onclick: () => ((answer = true), d.close()) }, o.ok);
    d.foot.append(h("span"), h("div", { style: "display:flex;gap:8px" }, h("button", { class: "cm-btn", onclick: d.close }, o.cancel ?? "Vazgeç"), ok));
    requestAnimationFrame(() => ok.focus());
  });
}
