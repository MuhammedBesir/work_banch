import { fold, num } from "../format";
import { readingOrder } from "../geometry";
import type { Color, Highlight, Mark } from "../types";
import { COLORS } from "../types";
import { h, kbd, marker } from "../util";

export type SortBy = "page" | "time" | "color";
type Kind = "all" | "hl" | "text" | "draw";

/** Panelde bir satır: bir vurgu ya da Yaz modu işareti (çizimler sayfa başına tek satır). */
type Row =
  | { type: "hl"; it: Highlight; page: number; y: number; x: number; created: number }
  | { type: "mark"; marks: Mark[]; page: number; y: number; x: number; created: number; id: string };

export interface PanelActions {
  jump(h: Highlight): void;
  jumpMark(m: Mark): void;
  editMark(m: Mark): void;
  removeMark(id: string): void;
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
  private marks: Mark[] = [];
  private kind: Kind = "all";
  private kinds: HTMLElement;
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
    this.kinds = h("div", { class: "cm-chips", role: "group", "aria-label": "Türe göre filtrele", hidden: true });
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
      search, this.kinds, this.chips, tools,
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

  setData(items: Highlight[], names: Record<Color, string>, marks: Mark[] = this.marks): void {
    this.items = items;
    this.names = names;
    this.marks = marks;
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
    if (this.kind !== "all" && this.kind !== "hl") return [];
    const q = fold(this.query.trim());
    return this.items.filter((it) =>
      (this.filter.size === 0 || this.filter.has(it.color)) &&
      (!q || fold(it.text).includes(q) || fold(it.note).includes(q) || fold(this.names[it.color]).includes(q)),
    );
  }

  /** Yaz modu satırları: metin kutusu ve not tek tek, kalem ve şekiller sayfa başına tek satır. */
  private markRows(): Row[] {
    if (this.kind === "hl" || this.filter.size) return [];
    const q = fold(this.query.trim());
    const rows: Row[] = [];
    const draw = new Map<number, Mark[]>();
    for (const m of this.marks) {
      if (m.kind === "text" || m.kind === "sticky") {
        if (this.kind === "draw" || !m.text.trim()) continue;
        if (q && !fold(m.text).includes(q)) continue;
        rows.push({ type: "mark", marks: [m], page: m.page, y: m.box[1], x: m.box[0], created: m.createdAt, id: m.id });
      } else if (this.kind !== "text" && !q) {
        draw.set(m.page, [...(draw.get(m.page) ?? []), m]);
      }
    }
    for (const [page, list] of draw) {
      const first = list.reduce((a, b) => (boxY(b) < boxY(a) ? b : a));
      rows.push({ type: "mark", marks: list, page, y: boxY(first), x: 0, created: Math.max(...list.map((m) => m.createdAt)), id: `draw-${page}` });
    }
    return rows;
  }

  private rows(): Row[] {
    // Sayfalar arası vurgunun yalnızca ilk parçası satır olur.
    const seen = new Set<string>();
    const hl: Row[] = this.visible().filter((it) => !it.group || (!seen.has(it.group) && !!seen.add(it.group)) ).map((it) => ({ type: "hl", it, page: it.page, y: it.rects[0]?.[1] ?? 0, x: it.rects[0]?.[0] ?? 0, created: it.createdAt }));
    const all = [...hl, ...this.markRows()];
    if (this.sort === "time") return all.sort((a, b) => b.created - a.created);
    if (this.sort === "color") {
      const color = (r: Row) => (r.type === "hl" ? r.it.color : 9);
      return all.sort((a, b) => color(a) - color(b) || a.page - b.page || a.y - b.y || a.x - b.x);
    }
    return all.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x || (a.type === "hl" && b.type === "hl" ? readingOrder(a.it, b.it) : 0));
  }

  private toggleAll(): void {
    const keys = new Set(this.rows().map((r) => rowKey(this.sort, r)));
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
    this.chips.hidden = this.kind === "text" || this.kind === "draw";
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
    // Tür filtresi yalnızca Yaz modu işaretleri varken görünür.
    const texts = this.marks.filter((m) => (m.kind === "text" || m.kind === "sticky") && m.text.trim()).length;
    const draws = this.marks.filter((m) => m.kind === "ink" || m.kind === "shape").length;
    this.kinds.hidden = texts + draws === 0;
    const kindChip = (k: Kind, label: string, n: number) =>
      chip([document.createTextNode(`${label} `), h("span", { class: "cm-num", text: num(n) })], this.kind === k, () => {
        this.kind = k;
        this.render();
      });
    this.kinds.replaceChildren(
      kindChip("all", "Tümü", this.items.length + texts + draws),
      kindChip("hl", "Vurgu", this.items.length),
      kindChip("text", "Yazı", texts),
      kindChip("draw", "Çizim", draws),
    );
  }

  render(): void {
    const writeCount = this.marks.filter((m) => !((m.kind === "text" || m.kind === "sticky") && !m.text.trim())).length;
    this.countEl.textContent = num(this.items.length + writeCount);
    this.renderChips();
    const scroll = this.list.scrollTop;

    if (!this.items.length && !writeCount) {
      this.list.replaceChildren(this.tutorial());
      return;
    }
    const rows = this.rows();
    if (!rows.length) {
      const reason = this.query.trim() ? `"${this.query.trim()}" için işaret ya da not bulunamadı.` : "Bu filtrede işaret yok.";
      this.list.replaceChildren(
        h("div", { class: "cm-panel__empty" },
          h("p", { style: "margin:0", text: reason }),
          h("div", {}, h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.clearFilter() }, "Filtreyi temizle")),
        ),
      );
      return;
    }

    const frag = document.createDocumentFragment();
    let lastKey = "";
    for (const r of rows) {
      const key = rowKey(this.sort, r);
      if (this.sort !== "time" && key !== lastKey) {
        lastKey = key;
        frag.append(this.groupHead(key, r, rows.filter((x) => rowKey(this.sort, x) === key)));
      }
      if (this.sort !== "time" && this.collapsed.has(key)) continue;
      frag.append(r.type === "hl" ? this.itemRow(r.it) : this.markRow(r));
    }
    this.list.replaceChildren(frag);
    this.list.scrollTop = scroll;
    this.newId = null;
  }

  private clearFilter(): void {
    this.query = "";
    this.filter.clear();
    this.kind = "all";
    (this.el.querySelector("input[type=search]") as HTMLInputElement).value = "";
    this.render();
  }

  private groupHead(key: string, first: Row, members: Row[]): HTMLElement {
    const collapsed = this.collapsed.has(key);
    const label = this.sort === "page" ? `Sayfa ${num(first.page + 1)}` : first.type === "hl" ? this.names[first.it.color] : "Yazı ve çizim";
    const marks = h("span", { class: "cm-group__marks" });
    if (collapsed) for (const c of new Set(members.flatMap((m) => (m.type === "hl" ? [m.it.color] : [])))) marks.append(marker(c));
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

  /** Yaz modu satırı: metin kutusu (T), yapışkan not (N), AI notu ya da sayfanın çizimleri. */
  private markRow(r: Extract<Row, { type: "mark" }>): HTMLElement {
    const m = r.marks[0];
    let badge: HTMLElement;
    let body: HTMLElement;
    let label: string;
    if (m.kind === "text" || m.kind === "sticky") {
      label = m.kind === "text" ? "Metin kutusu" : m.ai ? "AI notu" : "Yapışkan not";
      badge = h("span", { class: `cm-kind${m.kind === "sticky" ? " cm-kind--sticky" : ""}`, text: m.kind === "text" ? "T" : m.ai ? "AI" : "N" });
      body = h("div", {},
        h("div", { class: "cm-item__quote cm-item__quote--plain", text: m.text }),
        h("div", { class: "cm-item__meta" }, h("span", {}, h("span", { class: "cm-num", text: `s. ${num(m.page + 1)}` }), ` · ${label}`),
          h("button", { class: "cm-item__add", tabindex: "-1", onclick: (e: Event) => (e.stopPropagation(), this.actions.editMark(m)) }, "Düzenle")),
      );
    } else {
      const ink = r.marks.filter((x) => x.kind === "ink");
      const shapes = r.marks.length - ink.length;
      const color = (ink[0] ?? m) as Extract<Mark, { kind: "ink" | "shape" }>;
      label = [ink.length ? `Kalem · ${num(ink.length)} çizgi` : "", shapes ? `${num(shapes)} şekil` : ""].filter(Boolean).join(", ");
      badge = h("span", { class: `cm-penmark cm-penmark--${color.color}` });
      body = h("div", {},
        h("div", { class: "cm-item__quote cm-muted", text: "El yazısı ve çizimler aranamaz." }),
        h("div", { class: "cm-item__meta" }, h("span", {}, h("span", { class: "cm-num", text: `s. ${num(r.page + 1)}` }), ` · ${label}`)),
      );
    }
    const row = h("div", {
      class: `cm-item${this.selectedId === r.id ? " is-selected" : ""}`,
      role: "listitem",
      tabindex: "0",
      "data-id": r.id,
      "data-mark": "1",
      "aria-label": `${label}, sayfa ${r.page + 1}`,
    }, badge, body);
    row.addEventListener("click", () => {
      this.select(r.id, false);
      this.actions.jumpMark(m);
    });
    return row;
  }

  private itemRow(it: Highlight): HTMLElement {
    const name = this.names[it.color];
    // Sayfalar arası vurgu: parçaların metni tek alıntı, sayfa aralığı "s. 3–4".
    const parts = it.group ? this.items.filter((x) => x.group === it.group).sort((a, b) => a.page - b.page) : [it];
    const pageLabel = parts.length > 1 ? `s. ${num(parts[0].page + 1)}–${num(parts[parts.length - 1].page + 1)}` : `s. ${num(it.page + 1)}`;
    const quote = h("div", { class: "cm-item__quote" }, h("mark", { text: parts.map((p) => p.text).join(" ") }));
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
      const meta = h("div", { class: "cm-item__meta" }, h("span", {}, h("span", { class: "cm-num", text: pageLabel }), ` · ${name}`));
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
    else if (cur?.dataset.mark && id) {
      // Yaz modu satırı: Enter atlar, E düzenler, Delete siler (çizim satırı yalnızca atlar).
      const mark = this.marks.find((m) => m.id === id) ?? this.marks.find((m) => `draw-${m.page}` === id);
      if (!mark) return;
      if (e.key === "Enter") (this.select(id, false), this.actions.jumpMark(mark));
      else if (key === "e" && mark.id === id) this.actions.editMark(mark);
      else if ((e.key === "Delete" || e.key === "Backspace") && mark.id === id) {
        (rows[i + 1] ?? rows[i - 1])?.focus();
        this.actions.removeMark(id);
      } else return;
    } else if (e.key === "Enter" && id) {
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
const rowKey = (sort: SortBy, r: Row) => (sort === "color" ? (r.type === "hl" ? `c${r.it.color}` : "c9") : `p${r.page}`);
const boxY = (m: Mark) => (m.kind === "ink" ? Math.min(...m.points.map((p) => p[1])) : m.kind === "shape" ? Math.min(m.from[1], m.to[1]) : m.box[1]);
