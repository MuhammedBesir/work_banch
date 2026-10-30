import { h, kbd } from "../util";

export interface MenuItem {
  label: string;
  hint?: string;
  shortcut?: string;
  on?: boolean;
  danger?: boolean;
  run(): void;
}

/** Bir düğmenin altında açılan menü; dışarı tıklayınca ya da Esc ile kapanır. */
export function openMenu(anchor: HTMLElement, items: (MenuItem | "sep")[], align: "left" | "right" = "left"): () => void {
  const menu = h("div", { class: "cm-menu cm", role: "menu" });
  const buttons: HTMLButtonElement[] = [];
  for (const it of items) {
    if (it === "sep") {
      menu.append(h("div", { class: "cm-menu__sep", role: "separator" }));
      continue;
    }
    const b = h("button", {
      class: `cm-btn cm-btn--ghost${it.on ? " is-on" : ""}${it.danger ? " cm-btn--danger" : ""}`,
      role: "menuitem",
      onclick: () => (close(), it.run()),
    }, it.label);
    if (it.hint) b.append(h("span", { class: "cm-muted", style: "font-weight:400", text: it.hint }));
    if (it.shortcut) b.append(kbd(it.shortcut));
    buttons.push(b);
    menu.append(b);
  }
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  if (align === "right") menu.style.right = `${window.innerWidth - r.right}px`;
  else menu.style.left = `${r.left}px`;
  menu.style.position = "fixed";
  document.body.append(menu);

  const onDown = (e: MouseEvent) => !menu.contains(e.target as Node) && e.target !== anchor && close();
  const onKey = (e: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), close(), anchor.focus());
    else if (e.key === "ArrowDown") (e.preventDefault(), buttons[(i + 1) % buttons.length]?.focus());
    else if (e.key === "ArrowUp") (e.preventDefault(), buttons[(i - 1 + buttons.length) % buttons.length]?.focus());
    else return;
    e.stopPropagation();
  };
  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  (buttons.find((b) => b.classList.contains("is-on")) ?? buttons[0])?.focus();
  return close;
}
