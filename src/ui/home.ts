import { fold, num, relative } from "../format";
import type { FileRecord } from "../types";
import { h, kbd } from "../util";
import { icon } from "./icons";
import { openMenu, type MenuItem } from "./menu";

export const TRUST = "Dosyan bilgisayarından çıkmaz; açma, okuma ve vurgular tamamen bu tarayıcıda işlenir.";

export interface RecentRow {
  rec: FileRecord;
  highlights: number;
  /** Tarayıcı dosyaya hâlâ erişebiliyor mu (yalnızca tutamaç saklanabilen tarayıcılarda). */
  reachable: boolean;
}

export type Organize = "pin" | "folder" | "tags" | "cover" | "lock" | "remove";

export interface HomeActions {
  pick(): void;
  openRecent(row: RecentRow): void;
  clearRecent(): void;
  settings(): void;
  newNotebook(): void;
  importBundle(): void;
  organize(rec: FileRecord, what: Organize): void;
  /** Kapak önizlemesi (ilk sayfa), yoksa null. */
  thumb(hash: string): Promise<string | null>;
  view: "list" | "grid";
  setView(v: "list" | "grid"): void;
  /** Dersler (klasörler): oluştur, yeniden adlandır, sil, dosya taşı. */
  createFolder(): Promise<string | null>;
  renameFolder(name: string): Promise<string | null>;
  deleteFolder(name: string): Promise<boolean>;
  moveTo(hash: string, folder: string | null): void;
}

const DRAG_TYPE = "application/x-cm-file";

export interface HomeError {
  title: string;
  text: string;
  detail?: string;
}

/** Dosya açma ekranı: bırakma alanı, tek cümlelik güven mesajı ve son açılanlar. */
export class Home {
  readonly el: HTMLElement;
  private drop: HTMLElement;
  private dropSlot: HTMLElement;
  private recent: HTMLElement;
  private notice = h("div", { style: "display:contents" });

  constructor(private actions: HomeActions) {
    this.drop = h("section", { class: "cm-drop", "aria-label": "PDF aç" });
    this.dropSlot = h("div", { style: "display:contents" }, this.drop);
    this.recent = h("section", { class: "cm-recent", "aria-labelledby": "recent-h" });
    const bar = h("header", { class: "cm-bar" },
      h("span", { class: "cm-bar__brand" }, h("img", { class: "cm-bar__logo", src: "./icon.svg", alt: "", width: 22, height: 22 }), "Çalışma Masası"),
      h("span", { class: "cm-bar__spacer" }),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => actions.settings() }, "Ayarlar"),
    );
    this.el = h("div", { class: "cm-app" }, bar, h("div"), h("main", { class: "cm-home" }, this.dropSlot, this.notice, this.recent));
    this.showIdle();
  }

  showIdle(): void {
    this.drop.className = "cm-drop";
    this.drop.replaceChildren(
      h("div", { class: "cm-drop__icon", "aria-hidden": "true" }, icon("upload")),
      h("h1", { class: "cm-display", text: this.dropTitle() }),
      h("p", { class: "cm-muted", style: "margin:0", text: "Ders slaytları, kitap bölümleri, çıkmış sorular. Bir seferde bir dosya." }),
      h("div", { class: "cm-drop__actions" },
        h("button", { class: "cm-btn cm-btn--primary cm-btn--lg", title: "Dosya seç (Ctrl O)", onclick: () => this.actions.pick() }, "Dosya seç ", kbd("Ctrl O")),
      ),
      h("div", { class: "cm-drop__alt" },
        h("button", { class: "cm-drop__link", onclick: async () => {
          const n = await this.actions.createFolder();
          if (n) this.go(n);
        } }, icon("folder"), "Yeni ders"),
        h("button", { class: "cm-drop__link", onclick: () => this.actions.newNotebook() }, icon("notebook"), "Yeni not defteri"),
        h("button", { class: "cm-drop__link", onclick: () => this.actions.importBundle() }, icon("package"), "Paylaşım paketi aç"),
      ),
      h("p", { class: "cm-trust cm-drop__trust", text: TRUST }),
    );
    this.dropSlot.replaceChildren(this.drop);
  }

  showOver(name: string, size: string): void {
    this.drop.className = "cm-drop is-over";
    this.drop.replaceChildren(
      h("p", { class: "cm-display", style: "font-size:24px;line-height:30px", text: "Bırak, açalım" }),
      h("p", { class: "cm-muted", style: "margin:0", text: [name, size].filter(Boolean).join(" · ") }),
    );
  }

  showLoading(name: string): (done: number, total: number) => void {
    const label = h("span", { class: "cm-num" });
    const bar = h("div");
    this.drop.className = "cm-drop";
    this.drop.replaceChildren(
      h("p", { class: "cm-display", style: "font-size:24px;line-height:30px" }, "Açılıyor… ", label),
      h("div", { class: "cm-drop__progress" }, bar),
      h("p", { class: "cm-muted", style: "margin:0", text: `${name} · İlk sayfa hazır olduğunda hemen okuyabilirsin.` }),
    );
    this.dropSlot.replaceChildren(this.drop);
    return (done, total) => {
      label.textContent = total ? `${num(done)} / ${num(total)}` : "";
      bar.style.width = total ? `${(done / total) * 100}%` : "10%";
    };
  }

  /** Bozuk dosya / PDF olmayan dosya: bırakma alanının yerine. */
  showError(err: HomeError): void {
    const detail = err.detail
      ? h("details", { class: "cm-details" }, h("summary", { text: "Ayrıntı" }), h("pre", { class: "cm-code", text: err.detail }))
      : null;
    this.dropSlot.replaceChildren(
      h("div", { class: "cm-notice cm-notice--err", role: "alert" },
        h("span", { class: "cm-notice__sym", "aria-hidden": "true", text: "×" }),
        h("div", {},
          h("p", { class: "cm-notice__title", text: err.title }),
          h("p", { class: "cm-notice__text", text: err.text }),
          h("div", { style: "display:flex;gap:8px" },
            h("button", { class: "cm-btn cm-btn--primary cm-btn--sm", onclick: () => this.actions.pick() }, "Başka dosya seç"),
            h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.showIdle() }, "Kapat"),
          ),
          detail,
        ),
      ),
    );
  }

  /** Yedek hatırlatması gibi engellemeyen bildirimler. */
  setNotice(el: HTMLElement | null): void {
    this.notice.replaceChildren(...(el ? [el] : []));
  }

  private rows: RecentRow[] = [];
  /** "*" kitaplık (tümü), "pinned" sabitlenenler ya da bir dersin adı. */
  private folder: string = "*";
  private folders: string[] = [];

  /** Açık ders: o sırada açılan / bırakılan PDF bu derse eklenir. */
  get activeFolder(): string | null {
    return this.folder !== "*" && this.folder !== "pinned" ? this.folder : null;
  }

  private dropTitle(): string {
    return this.activeFolder ? `${this.activeFolder} dersine PDF bırak` : "PDF'ini buraya bırak";
  }

  showFolder(folder: string): void {
    if (this.folders.includes(folder)) this.go(folder);
  }

  private go(folder: string): void {
    this.folder = folder;
    this.query = "";
    this.renderRecent(this.rows, this.folders);
    this.recent.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }
  private tag = "";
  private query = "";

  renderRecent(rows: RecentRow[], knownFolders: string[] = this.folders): void {
    this.rows = rows;
    const title = this.drop.querySelector(".cm-display");
    if (title && this.drop.querySelector(".cm-drop__actions")) title.textContent = this.dropTitle();
    // Dosya varken bırakma alanı tek satırlık kompakt karta dönüşür; liste öne çıkar.
    this.recent.parentElement?.classList.toggle("has-recent", rows.length > 0);
    const foot = h("p", { class: "cm-muted cm-recent__foot", text: "Vurgular bu tarayıcıda saklanır. Tarayıcı verilerini silersen kaybolur; düzenli olarak yedek al ya da Markdown'a aktar." });
    // Boş dersler de görünür (ders önce oluşturulup PDF'ler sonra eklenebilir).
    const folders = [...new Set([...knownFolders, ...rows.map((r) => r.rec.folder).filter((f): f is string => !!f)])].sort((a, b) => a.localeCompare(b, "tr"));
    this.folders = folders;
    if (!rows.length && !folders.length) {
      foot.classList.add("is-alone");
      this.recent.replaceChildren(foot);
      return;
    }
    const tags = [...new Set(rows.flatMap((r) => r.rec.tags ?? []))].sort((a, b) => a.localeCompare(b, "tr"));
    if (this.folder !== "*" && this.folder !== "pinned" && !folders.includes(this.folder)) this.folder = "*";
    const inFolder = this.activeFolder;
    if (this.tag && !tags.includes(this.tag)) this.tag = "";
    const q = fold(this.query.trim());
    const shown = rows
      .filter((r) => this.folder === "*" || (this.folder === "pinned" ? r.rec.pinned : r.rec.folder === this.folder))
      .filter((r) => !this.tag || r.rec.tags?.includes(this.tag))
      .filter((r) => !q || fold([r.rec.name, ...(r.rec.aliases ?? []), r.rec.folder ?? "", ...(r.rec.tags ?? [])].join(" ")).includes(q))
      // Sabitlenenler başta.
      .sort((a, b) => Number(!!b.rec.pinned) - Number(!!a.rec.pinned));

    const chip = (label: string, on: boolean, run: () => void) =>
      h("button", { class: `cm-chip${on ? " is-on" : ""}`, "aria-pressed": String(on), onclick: run }, label);
    const search = h("input", { class: "cm-input cm-recent__search", type: "search", placeholder: "Dosyalarda ara", "aria-label": "Son açılanlarda ara", value: this.query });
    search.addEventListener("input", () => {
      this.query = search.value;
      const at = search.selectionStart;
      this.renderRecent(this.rows, this.folders);
      const again = this.recent.querySelector<HTMLInputElement>(".cm-recent__search");
      again?.focus();
      if (at !== null) again?.setSelectionRange(at, at);
    });
    // Dersin içinde ders kartları yerine yalnızca etiketler; kitaplıkta sabitlenenler ve etiketler.
    const pinned = !inFolder && rows.some((r) => r.rec.pinned);
    const hasFilters = tags.length || pinned;
    const filters = !hasFilters ? null : h("div", { class: "cm-recent__filters", role: "group", "aria-label": "Filtre" },
      pinned ? chip("Tümü", this.folder === "*", () => this.go("*")) : null,
      pinned ? chip("★ Sabitlenenler", this.folder === "pinned", () => this.go("pinned")) : null,
      ...tags.map((t) => chip(`#${t}`, this.tag === t, () => ((this.tag = this.tag === t ? "" : t), this.renderRecent(this.rows, this.folders)))),
    );
    const view = h("div", { class: "cm-seg cm-seg--sm", role: "group", "aria-label": "Görünüm" },
      h("button", { class: this.actions.view === "list" ? "is-on" : "", "aria-pressed": String(this.actions.view === "list"), onclick: () => this.actions.setView("list") }, "Liste"),
      h("button", { class: this.actions.view === "grid" ? "is-on" : "", "aria-pressed": String(this.actions.view === "grid"), onclick: () => this.actions.setView("grid") }, "Kapaklar"),
    );
    const content = !shown.length
      ? (inFolder && !q && !this.tag
          ? h("div", { class: "cm-folder__empty" },
              h("p", { style: "margin:0;font-weight:600", text: "Bu derste henüz PDF yok" }),
              h("p", { class: "cm-muted", style: "margin:0", text: "\"PDF ekle\" ile seç ya da PDF'i bu sayfaya sürükleyip bırak; bu derse eklenir. Kitaplıktaki bir dosyayı da ders kartına sürükleyebilirsin." }))
          : h("p", { class: "cm-muted", text: "Bu filtrede dosya yok." }))
      : this.actions.view === "grid" ? this.grid(shown) : this.table(shown);

    if (inFolder) {
      // Dersin içi: geri, ders adı, PDF ekle, ders menüsü.
      const back = h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--withicon cm-folder__back", onclick: () => this.go("*") }, icon("back"), "Kitaplık");
      this.dropTarget(back, null);
      const more = h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-label": `${inFolder}: ders seçenekleri`, "aria-haspopup": "menu" }, "⋯");
      more.addEventListener("click", () => openMenu(more, [
        { label: "Yeniden adlandır…", run: async () => {
          const n = await this.actions.renameFolder(inFolder);
          if (n) this.folder = n;
        } },
        "sep",
        { label: "Dersi sil…", danger: true, hint: "PDF'ler kitaplıkta kalır", run: async () => {
          if (await this.actions.deleteFolder(inFolder)) this.folder = "*";
        } },
      ], "right"));
      const count = rows.filter((r) => r.rec.folder === inFolder).length;
      this.recent.replaceChildren(
        back,
        h("div", { class: "cm-recent__head cm-folder__head" },
          h("div", { class: "cm-folder__title" },
            h("span", { class: "cm-folder__icon", "aria-hidden": "true" }, icon("folder")),
            h("h2", { id: "recent-h", tabindex: "-1", text: inFolder }),
            h("span", { class: "cm-muted cm-num", text: `${num(count)} PDF` })),
          h("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, search, view,
            h("button", { class: "cm-btn cm-btn--primary cm-btn--sm cm-btn--withicon", onclick: () => this.actions.pick() }, icon("plus"), "PDF ekle"),
            more),
        ),
        ...(filters ? [filters] : []),
        content,
        foot,
      );
      return;
    }

    // Kitaplık: önce dersler, sonra son açılanlar.
    const stats = (f: string) => {
      const list = rows.filter((r) => r.rec.folder === f);
      return { files: list.length, hl: list.reduce((a, r) => a + r.highlights, 0), last: Math.max(0, ...list.map((r) => r.rec.lastOpened)) };
    };
    const card = (f: string) => {
      const s = stats(f);
      const b = h("button", { class: "cm-foldercard", onclick: () => this.go(f), "aria-label": `${f} dersi, ${s.files} PDF` },
        h("span", { class: "cm-foldercard__icon", "aria-hidden": "true" }, icon("folder")),
        h("span", { class: "cm-foldercard__name", text: f }),
        h("span", { class: "cm-foldercard__meta cm-muted", text: s.files ? `${num(s.files)} PDF${s.hl ? ` · ${num(s.hl)} vurgu` : ""}` : "Boş" }),
      );
      this.dropTarget(b, f);
      return h("li", {}, b);
    };
    const courses = h("section", { class: "cm-courses", "aria-labelledby": "courses-h" },
      h("div", { class: "cm-recent__head" },
        h("h2", { id: "courses-h", text: "Derslerim" }),
        folders.length ? h("span", { class: "cm-muted cm-courses__hint", style: "font-size:13px", text: "PDF'i bir derse sürükleyerek taşıyabilirsin" }) : null),
      h("ul", { class: "cm-foldergrid", role: "list" },
        ...folders.map(card),
        h("li", {}, h("button", { class: "cm-foldercard cm-foldercard--new", onclick: async () => {
          const n = await this.actions.createFolder();
          if (n) this.go(n);
        } },
          h("span", { class: "cm-foldercard__icon", "aria-hidden": "true" }, icon("plus")),
          h("span", { class: "cm-foldercard__name", text: "Yeni ders" }),
          h("span", { class: "cm-foldercard__meta cm-muted", text: "PDF'lerini bir arada tut" }))),
      ),
    );
    this.recent.replaceChildren(
      courses,
      ...(rows.length ? [
        h("div", { class: "cm-recent__head" },
          h("h2", { id: "recent-h", text: "Son açılanlar" }),
          h("div", { style: "display:flex;gap:8px;align-items:center" }, search, view,
            h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.actions.clearRecent() }, "Listeyi temizle")),
        ),
        ...(filters ? [filters] : []),
        content,
      ] : []),
      foot,
    );
  }

  /** Kitaplıktaki bir dosya buraya sürüklenince derse (ya da null: dersten çıkar) taşınır. */
  private dropTarget(el: HTMLElement, folder: string | null): void {
    const ok = (e: DragEvent) => !!e.dataTransfer?.types.includes(DRAG_TYPE);
    el.addEventListener("dragover", (e) => {
      if (!ok(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      el.classList.add("is-dropover");
    });
    el.addEventListener("dragleave", () => el.classList.remove("is-dropover"));
    el.addEventListener("drop", (e) => {
      el.classList.remove("is-dropover");
      if (!ok(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.actions.moveTo(e.dataTransfer!.getData(DRAG_TYPE), folder);
    });
  }

  private draggable(el: HTMLElement, rec: FileRecord): void {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, rec.hash);
      e.dataTransfer!.effectAllowed = "move";
      el.classList.add("is-dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("is-dragging"));
  }

  private menu(anchor: HTMLElement, rec: FileRecord): void {
    const items: (MenuItem | "sep")[] = [
      { label: rec.pinned ? "Sabitlemeyi kaldır" : "Başa sabitle", run: () => this.actions.organize(rec, "pin") },
      { label: "Derse taşı…", hint: rec.folder ?? "", run: () => this.actions.organize(rec, "folder") },
      ...(rec.folder ? [{ label: "Dersten çıkar", run: () => this.actions.moveTo(rec.hash, null) }] : []),
      { label: "Etiketler…", hint: rec.tags?.length ? `${rec.tags.length}` : "", run: () => this.actions.organize(rec, "tags") },
      { label: "Kapak rengi…", run: () => this.actions.organize(rec, "cover") },
      { label: rec.lock ? "Kilidi kaldır…" : "Kilitle…", run: () => this.actions.organize(rec, "lock") },
      "sep",
      { label: "Listeden kaldır", danger: true, run: () => this.actions.organize(rec, "remove") },
    ];
    openMenu(anchor, items, "right");
  }

  private openButton(row: RecentRow): HTMLElement {
    return row.reachable
      ? h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.actions.openRecent(row), "aria-label": `${row.rec.name} dosyasını aç` }, row.rec.lock ? "Kilidi aç" : "Aç")
      : h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.actions.openRecent(row) }, "Dosyayı yeniden seç");
  }

  private more(rec: FileRecord): HTMLElement {
    const b = h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-label": `${rec.name}: düzenle`, "aria-haspopup": "menu", title: "Sabitle, klasör, etiket, kapak, kilit" }, "⋯");
    b.addEventListener("click", (e) => (e.stopPropagation(), this.menu(b, rec)));
    return b;
  }

  private badges(rec: FileRecord): HTMLElement[] {
    return [
      ...(rec.pinned ? [h("span", { class: "cm-recent__badge", title: "Sabitlendi", text: "★" })] : []),
      ...(rec.lock ? [h("span", { class: "cm-recent__badge", title: "Kilitli", text: "🔒" })] : []),
      ...(rec.folder && rec.folder !== this.activeFolder ? [h("span", { class: "cm-tag", text: rec.folder })] : []),
      ...(rec.tags ?? []).map((t) => h("span", { class: "cm-tag cm-tag--soft", text: `#${t}` })),
    ];
  }

  private table(rows: RecentRow[]): HTMLElement {
    const body = h("tbody");
    for (const row of rows) {
      const { rec } = row;
      const name = h("td", {}, h("div", { style: "font-weight:500;overflow-wrap:anywhere;display:flex;gap:6px;align-items:center;flex-wrap:wrap" }, h("span", { text: rec.name }), ...this.badges(rec)));
      if (rec.aliases?.length) name.append(h("div", { class: "cm-muted cm-recent__lost", text: `Diğer adları: ${rec.aliases.join(", ")}` }));
      if (!row.reachable) {
        name.append(h("div", { class: "cm-muted cm-recent__lost", text: "Tarayıcı bu dosyaya erişimi bıraktı. Aynı dosyayı seçince vurgular geri gelir." }));
      }
      const tr = h("tr", {},
          name,
          h("td", { style: "white-space:nowrap" }, h("span", { class: "cm-num", text: `Sayfa ${num(rec.lastPage + 1)} / ${num(rec.pageCount)}` })),
          h("td", { style: "white-space:nowrap" },
            row.highlights ? h("span", {}, h("span", { class: "cm-num", text: num(row.highlights) }), " vurgu") : h("span", { class: "cm-muted", text: "Vurgu yok" }),
          ),
          h("td", { class: "cm-muted", style: "white-space:nowrap", text: relative(rec.lastOpened) }),
          h("td", { style: "white-space:nowrap" }, this.openButton(row), this.more(rec)),
        );
      this.draggable(tr, rec);
      body.append(tr);
    }
    return h("div", { class: "cm-table-wrap" },
      h("table", { class: "cm-table" },
        h("thead", {}, h("tr", {},
          h("th", { text: "Dosya" }), h("th", { style: "white-space:nowrap", text: "Kaldığın yer" }), h("th", { text: "Vurgular" }),
          h("th", { style: "white-space:nowrap", text: "Son açılış" }), h("th", {}),
        )),
        body,
      ),
    );
  }

  /** Kapak görünümü: ilk sayfa önizlemesi (kilitliyse renk), ad, kaldığın yer. */
  private grid(rows: RecentRow[]): HTMLElement {
    const grid = h("ul", { class: "cm-covers", role: "list" });
    for (const row of rows) {
      const { rec } = row;
      const cover = h("div", { class: "cm-cover__img", "aria-hidden": "true" }, h("span", { class: "cm-cover__initial", text: rec.name.replace(/\.pdf$/i, "").slice(0, 2) }));
      if (rec.cover) cover.style.setProperty("--cover", rec.cover);
      if (!rec.lock) {
        void this.actions.thumb(rec.hash).then((src) => {
          if (src) cover.replaceChildren(h("img", { src, alt: "" }));
        });
      } else cover.append(h("span", { class: "cm-cover__lock", text: "🔒" }));
      const open = h("button", { class: "cm-cover__open", "aria-label": `${rec.name} dosyasını ${row.reachable ? "aç" : "yeniden seç"}`, onclick: () => this.actions.openRecent(row) }, cover);
      const li = h("li", { class: "cm-cover" },
        open,
        h("div", { class: "cm-cover__meta" },
          h("div", { class: "cm-cover__title", title: rec.name, text: rec.name.replace(/\.pdf$/i, "") }),
          this.more(rec),
        ),
        h("div", { class: "cm-cover__sub cm-muted cm-num", text: `${num(rec.lastPage + 1)}/${num(rec.pageCount)} · ${row.highlights ? `${num(row.highlights)} vurgu` : relative(rec.lastOpened)}` }),
        h("div", { class: "cm-cover__badges" }, ...this.badges(rec)),
        row.reachable ? null : h("div", { class: "cm-muted cm-recent__lost", text: "Dosyayı yeniden seçmen gerekiyor." }),
      );
      this.draggable(li, rec);
      grid.append(li);
    }
    return grid;
  }
}
