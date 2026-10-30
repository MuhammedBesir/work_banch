import { fold, num } from "../format";
import { readingOrder } from "../geometry";
import type { Color, Highlight } from "../types";
import { COLORS } from "../types";
import { h, kbd, marker } from "../util";

export type SortBy = "page" | "time" | "color";

export interface PanelActions {
  jump(h: Highlight): void;
  saveNote(id: string, note: string): void;
  remove(id: string): void;
  resize(width: number): void;
}

/** Sağ vurgu paneli: arama, renge göre filtre, sayfaya göre gruplu liste, not alanı ve boş durumlar. */
export class Panel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private countEl: HTMLElement;
  private chips: HTMLElement;
  private query = "";
  private filter = new Set<Color>();
  private sort: SortBy = "page";
  private collapsed = new Set<string>();
  private follow = true;
  private followPaused = false;
  private selectedId: string | null = null;
  private editingId: string | null = null;
  private newId: string | null = null;
  private items: Highlight[] = [];
  private names: Record<Color, string>;
  private currentPage = 0;
  private programmaticScroll = false;
  private followBtn: HTMLButtonElement;
  private returnBar: HTMLElement;

  constructor(names: Record<Color, string>, private actions: PanelActions) {
    this.names = names;
    this.countEl = h("span", { class: "cm-muted cm-num" });
    const search = h("input", { class: "cm-input", type: "search", placeholder: "Vurgularda ve notlarda ara", "aria-label": "Vurgularda ve notlarda ara" });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
    });
    this.chips = h("div", { class: "cm-chips", role: "group", "aria-label": "Renge göre filtrele" });
    this.followBtn = h("button", { class: "cm-linkbtn is-on", "aria-pressed": "true", onclick: () => this.setFollow(!this.follow) }, "Sayfayı takip et");
    const sortSel = h("select", { class: "cm-select", "aria-label": "Sırala" },
      h("option", { value: "page", text: "Sırala: Sayfa" }),
      h("option", { value: "time", text: "Sırala: Eklenme" }),
      h("option", { value: "color", text: "Sırala: Renk" }),
    );
    sortSel.addEventListener("change", () => {
      this.sort = sortSel.value as SortBy;
      this.render();
    });
    const tools = h("div", { class: "cm-panel__tools" },
      h("button", { class: "cm-linkbtn", onclick: () => this.toggleAll() }, "Tümünü daralt"),
      this.followBtn,
      sortSel,
    );
    const head = h("div", { class: "cm-panel__head" },
      h("div", { class: "cm-panel__title" }, h("span", { text: "İşaretler" }), this.countEl),
      search, this.chips, tools,
    );
    this.list = h("div", { class: "cm-list", role: "list", tabindex: "-1" });
    this.list.addEventListener("keydown", this.onListKey);
    this.list.addEventListener("scroll", () => {
      if (this.programmaticScroll) return;
      if (this.follow && !this.followPaused) {
        // Kullanıcı paneli elle kaydırırsa takip duraklar.
        this.followPaused = true;
        this.returnBar.hidden = false;
      }
    }, { passive: true });
    this.returnBar = h("div", { class: "cm-panel__follow", hidden: true },
      h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.resumeFollow() }, "Okuduğum sayfaya dön"),
    );
    const resize = h("div", { class: "cm-panel__resize", role: "separator", "aria-orientation": "vertical", "aria-label": "Panel genişliği", tabindex: "0" });
    this.bindResize(resize);
    const foot = h("div", { class: "cm-panel__foot" }, h("span", { class: "cm-trust", text: "Bu cihazda saklanıyor" }), h("span", {}, kbd("J"), " ", kbd("K"), " gez · ", kbd("Enter"), " atla"));
    this.el = h("aside", { class: "cm-panel", "aria-label": "Vurgular ve notlar" }, resize, head, this.list, this.returnBar, foot);
  }

  setData(items: Highlight[], names: Record<Color, string>): void {
    this.items = items;
    this.names = names;
    this.render();
  }

  /** Yeni vurgu: satır doğru sıraya eklenir ve 600 ms belirir. */
  markNew(id: string): void {
    this.newId = id;
    this.selectedId = id;
  }

  select(id: string | null, scroll = true): void {
    this.selectedId = id;
    this.list.querySelectorAll(".cm-item.is-selected").forEach((x) => x.classList.remove("is-selected"));
    if (!id) return;
    const row = this.row(id);
    row?.classList.add("is-selected");
    if (scroll && row) this.scrollIntoView(row);
  }

  /** Bir vurgunun not alanını odaklı açar; sayfa yerinden oynamaz. */
  editNote(id: string): void {
    const it = this.items.find((x) => x.id === id);
    if (!it) return;
    this.collapsed.delete(groupKey(this.sort, it));
    if (!this.visible().some((x) => x.id === id)) {
      this.query = "";
      this.filter.clear();
      (this.el.querySelector("input[type=search]") as HTMLInputElement).value = "";
    }
    this.editingId = id;
    this.selectedId = id;
    this.render();
    const box = this.list.querySelector<HTMLTextAreaElement>(`.cm-item[data-id="${CSS.escape(id)}"] textarea`);
    if (box) {
      this.scrollIntoView(box.closest(".cm-item")!);
      box.focus({ preventScroll: true });
      box.setSelectionRange(box.value.length, box.value.length);
    }
  }

  focusList(): void {
    const row = (this.selectedId && this.row(this.selectedId)) || this.list.querySelector<HTMLElement>(".cm-item");
    row?.focus();
  }

  pageChanged(page: number): void {
    this.currentPage = page;
    if (!this.follow || this.followPaused || this.sort !== "page") return;
    const groups = [...this.list.querySelectorAll<HTMLElement>(".cm-group__head")];
    const target = groups.filter((g) => Number(g.dataset.page) <= page).at(-1);
    if (target) {
      this.programmaticScroll = true;
      this.list.scrollTop = target.offsetTop;
      requestAnimationFrame(() => (this.programmaticScroll = false));
    }
  }

  private setFollow(on: boolean): void {
    this.follow = on;
    this.followPaused = false;
    this.returnBar.hidden = true;
    this.followBtn.classList.toggle("is-on", on);
    this.followBtn.setAttribute("aria-pressed", String(on));
    if (on) this.pageChanged(this.currentPage);
  }

  private resumeFollow(): void {
    this.followPaused = false;
    this.returnBar.hidden = true;
    this.pageChanged(this.currentPage);
  }

  private row(id: string): HTMLElement | null {
    return this.list.querySelector<HTMLElement>(`.cm-item[data-id="${CSS.escape(id)}"]`);
  }

  private scrollIntoView(el: HTMLElement): void {
    this.programmaticScroll = true;
    el.scrollIntoView({ block: "nearest" });
    requestAnimationFrame(() => (this.programmaticScroll = false));
  }

  private visible(): Highlight[] {
    const q = fold(this.query.trim());
    return this.items.filter((it) =>
      (this.filter.size === 0 || this.filter.has(it.color)) &&
      (!q || fold(it.text).includes(q) || fold(it.note).includes(q) || fold(this.names[it.color]).includes(q)),
    );
  }

  private toggleAll(): void {
    const keys = new Set(this.visible().map((it) => groupKey(this.sort, it)));
    const allCollapsed = [...keys].every((k) => this.collapsed.has(k));
    if (allCollapsed) this.collapsed.clear();
    else keys.forEach((k) => this.collapsed.add(k));
    this.render();
  }

  private renderChips(): void {
    const counts = new Map<Color, number>(COLORS.map((c) => [c, 0]));
    for (const it of this.items) counts.set(it.color, (counts.get(it.color) ?? 0) + 1);
    const chip = (label: Node[], on: boolean, onclick: () => void) =>
      h("button", { class: `cm-chip${on ? " is-on" : ""}`, "aria-pressed": String(on), onclick }, ...label);
    this.chips.replaceChildren(
      chip([document.createTextNode("Tümü "), h("span", { class: "cm-num", text: num(this.items.length) })], this.filter.size === 0, () => {
        this.filter.clear();
        this.render();
      }),
      ...COLORS.map((c) =>
        chip([marker(c), document.createTextNode(this.names[c] + " "), h("span", { class: "cm-num", text: num(counts.get(c)!) })], this.filter.has(c), () => {
          // Birden fazla çip seçilebilir.
          if (this.filter.has(c)) this.filter.delete(c);
          else this.filter.add(c);
          if (this.filter.size === COLORS.length) this.filter.clear();
          this.render();
        }),
      ),
    );
  }

  render(): void {
    this.countEl.textContent = num(this.items.length);
    this.renderChips();
    const scroll = this.list.scrollTop;

    if (!this.items.length) {
      this.list.replaceChildren(this.tutorial());
      return;
    }
    const vis = this.visible();
    if (!vis.length) {
      const reason = this.query.trim() ? `"${this.query.trim()}" için vurgu ya da not bulunamadı.` : "Seçili renklerde vurgu yok.";
      this.list.replaceChildren(
        h("div", { class: "cm-panel__empty" },
          h("p", { style: "margin:0", text: reason }),
          h("div", {}, h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.clearFilter() }, "Filtreyi temizle")),
        ),
      );
      return;
    }

    const sorted = [...vis].sort(
      this.sort === "time" ? (a, b) => b.createdAt - a.createdAt
        : this.sort === "color" ? (a, b) => a.color - b.color || readingOrder(a, b)
        : readingOrder,
    );
    const frag = document.createDocumentFragment();
    let lastKey = "";
    for (let i = 0; i < sorted.length; i++) {
      const it = sorted[i];
      const key = groupKey(this.sort, it);
      if (this.sort !== "time" && key !== lastKey) {
        lastKey = key;
        const members = sorted.filter((x) => groupKey(this.sort, x) === key);
        frag.append(this.groupHead(key, it, members));
      }
      if (this.sort !== "time" && this.collapsed.has(key)) continue;
      frag.append(this.itemRow(it));
    }
    this.list.replaceChildren(frag);
    this.list.scrollTop = scroll;
    this.newId = null;
  }

  private clearFilter(): void {
    this.query = "";
    this.filter.clear();
    (this.el.querySelector("input[type=search]") as HTMLInputElement).value = "";
    this.render();
  }

  private groupHead(key: string, first: Highlight, members: Highlight[]): HTMLElement {
    const collapsed = this.collapsed.has(key);
    const label = this.sort === "page" ? `Sayfa ${num(first.page + 1)}` : this.names[first.color];
    const marks = h("span", { class: "cm-group__marks" });
    if (collapsed) for (const c of new Set(members.map((m) => m.color))) marks.append(marker(c));
    const btn = h("button", {
      class: "cm-group__head",
      "aria-expanded": String(!collapsed),
      "data-page": first.page,
      onclick: () => {
        if (this.collapsed.has(key)) this.collapsed.delete(key);
        else this.collapsed.add(key);
        this.render();
      },
    },
      h("span", {}, h("span", { class: "cm-num", text: label }), marks),
      h("span", { class: "cm-num", text: num(members.length) }),
    );
    return btn;
  }

  private itemRow(it: Highlight): HTMLElement {
    const name = this.names[it.color];
    const quote = h("div", { class: "cm-item__quote" }, h("mark", { text: it.text }));
    (quote.firstChild as HTMLElement).style.setProperty("--hl", `var(--hl-${it.color})`);
    const body = h("div", {}, quote);
    const editing = this.editingId === it.id;
    if (editing) {
      const box = h("textarea", { class: "cm-notebox", "aria-label": `Not, sayfa ${it.page + 1}`, placeholder: "Notun…", rows: 3 });
      box.value = it.note;
      let timer = 0;
      const save = () => this.actions.saveNote(it.id, box.value);
      box.addEventListener("input", () => {
        clearTimeout(timer);
        timer = window.setTimeout(save, 300); // not otomatik kaydedilir
      });
      const finish = () => {
        clearTimeout(timer);
        save();
        this.editingId = null;
        this.render();
        this.row(it.id)?.focus();
      };
      box.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) || e.key === "Escape") {
          e.preventDefault();
          finish();
        }
      });
      box.addEventListener("blur", () => {
        if (this.editingId === it.id) {
          clearTimeout(timer);
          save();
          this.editingId = null;
          setTimeout(() => this.render(), 0);
        }
      });
      body.append(box, h("div", { class: "cm-item__meta" }, h("span", {}, kbd("Ctrl Enter"), " kapat"), h("span", { text: "Otomatik kaydedilir" })));
    } else {
      if (it.note.trim()) body.append(h("div", { class: "cm-item__note", text: it.note }));
      const meta = h("div", { class: "cm-item__meta" }, h("span", {}, h("span", { class: "cm-num", text: `s. ${num(it.page + 1)}` }), ` · ${name}`));
      meta.append(
        h("button", {
          class: "cm-item__add",
          tabindex: "-1",
          onclick: (e: Event) => (e.stopPropagation(), this.editNote(it.id)),
        }, it.note.trim() ? "Notu düzenle" : "+ Not ekle"),
      );
      body.append(meta);
    }
    const row = h("div", {
      class: `cm-item${this.selectedId === it.id ? " is-selected" : ""}${this.newId === it.id ? " is-new" : ""}`,
      role: "listitem",
      tabindex: "0",
      "data-id": it.id,
      "aria-label": `${name} vurgusu, sayfa ${it.page + 1}`,
    }, marker(it.color), body);
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("textarea")) return;
      this.select(it.id, false);
      this.actions.jump(it);
    });
    return row;
  }

  private onListKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
    const rows = [...this.list.querySelectorAll<HTMLElement>(".cm-item")];
    const cur = (e.target as HTMLElement).closest<HTMLElement>(".cm-item");
    const i = cur ? rows.indexOf(cur) : -1;
    const id = cur?.dataset.id;
    const key = e.key.toLowerCase();
    if (key === "j" || e.key === "ArrowDown") rows[Math.min(rows.length - 1, i + 1)]?.focus();
    else if (key === "k" || e.key === "ArrowUp") rows[Math.max(0, i - 1)]?.focus();
    else if (e.key === "Enter" && id) {
      const it = this.items.find((x) => x.id === id);
      if (it) (this.select(id, false), this.actions.jump(it));
    } else if (key === "e" && id) this.editNote(id);
    else if ((e.key === "Delete" || e.key === "Backspace") && id) {
      (rows[i + 1] ?? rows[i - 1])?.focus();
      this.actions.remove(id);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /** Boş durum öğretici: dört rengi, şeklini ve tuşunu gösterir. */
  private tutorial(): HTMLElement {
    return h("div", { class: "cm-panel__empty" },
      h("h3", { text: "Henüz vurgu yok" }),
      h("p", { class: "cm-muted", style: "margin:0", text: "Sayfada metni seç, sonra bir renge tıkla ya da tuşuna bas." }),
      h("ol", {}, ...COLORS.map((c) =>
        h("li", {},
          h("span", { class: `cm-float__sw cm-float__sw--${c}`, style: "cursor:default" }, marker(c)),
          h("span", { text: this.names[c] }),
          kbd(String(c)),
        ),
      )),
      h("p", { class: "cm-muted", style: "margin:0;font-size:13px;line-height:18px" }, "Not eklemek için seçimden sonra ", kbd("N"), "."),
    );
  }

  private bindResize(handle: HTMLElement): void {
    let startX = 0;
    let startW = 0;
    const move = (e: PointerEvent) => {
      const w = Math.min(480, Math.max(280, startW + (startX - e.clientX)));
      this.actions.resize(w);
    };
    const up = () => {
      handle.classList.remove("is-drag");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      startW = this.el.getBoundingClientRect().width;
      handle.classList.add("is-drag");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    handle.addEventListener("keydown", (e) => {
      const w = this.el.getBoundingClientRect().width;
      if (e.key === "ArrowLeft") this.actions.resize(Math.min(480, w + 16));
      else if (e.key === "ArrowRight") this.actions.resize(Math.max(280, w - 16));
      else return;
      e.preventDefault();
    });
  }
}

const groupKey = (sort: SortBy, it: Highlight) => (sort === "color" ? `c${it.color}` : `p${it.page}`);
