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

/** Ders kartının rengi: ada göre sabit (6 ton), kullanıcı kapak rengi seçtiyse o. */
const COURSE_HUES = [212, 262, 330, 20, 150, 45];
function courseHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return COURSE_HUES[h % COURSE_HUES.length];
}
const PROGRESS_MIN = 0.04;

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
      h("span", { class: "cm-bar__brand" }, h("img", { class: "cm-bar__logo", src: "./icon.svg", alt: "", width: 22, height: 22 }), "Defter"),
      h("span", { class: "cm-bar__spacer" }),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--icon", "aria-label": "Ayarlar", title: "Ayarlar", onclick: () => actions.settings() }, icon("settings")),
    );
    // Yedek hatırlatması kitaplığın altında, tek satır: içerik önce gelir.
    this.el = h("div", { class: "cm-app" }, bar, h("div"), h("main", { class: "cm-home" }, this.dropSlot, this.recent, this.notice));
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
    this.syncDrop();
  }

  /** Kitaplıkta dosya ya da ders varsa karşılama kartı gizlenir; eylemler başlıkta. Yükleme/hata kartları her zaman görünür. */
  private syncDrop(): void {
    const idle = !!this.drop.querySelector(".cm-drop__actions");
    const hasContent = this.rows.length > 0 || this.folders.length > 0;
    this.dropSlot.replaceChildren(...(idle && hasContent ? [] : [this.drop]));
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
    const foot = h("p", { class: "cm-muted cm-recent__foot", text: "Vurgular bu tarayıcıda saklanır. Tarayıcı verilerini silersen kaybolur; düzenli olarak yedek al ya da Markdown'a aktar." });
    // Boş dersler de görünür (ders önce oluşturulup PDF'ler sonra eklenebilir).
    const folders = [...new Set([...knownFolders, ...rows.map((r) => r.rec.folder).filter((f): f is string => !!f)])].sort((a, b) => a.localeCompare(b, "tr"));
    this.folders = folders;
    // Dosya ya da ders varsa kitaplık düzeni: karşılama kartı yerine başlık + eylemler.
    this.recent.parentElement?.classList.toggle("has-recent", rows.length > 0 || folders.length > 0);
    this.syncDrop();
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
      : this.actions.view === "grid" ? this.grid(shown) : this.list(shown, !!inFolder);

    // Hızlı eylemler (başlıkta): yeni ders, not defteri, seyrek olanlar ⋯ menüsünde; birincil "PDF aç" en sağda.
    const libMore = h("button", { class: "cm-btn cm-btn--icon", "aria-label": "Diğer: paylaşım paketi aç, listeyi temizle", title: "Diğer", "aria-haspopup": "menu" }, icon("more"));
    libMore.addEventListener("click", () => openMenu(libMore, [
      { label: "Paylaşım paketi aç…", hint: ".json", run: () => this.actions.importBundle() },
      ...(rows.length ? ["sep" as const, { label: "Son açılanları temizle", run: () => this.actions.clearRecent() }] : []),
    ], "right"));
    const quick = (primaryLabel: string) => h("div", { class: "cm-lib__actions" },
      h("button", { class: "cm-btn cm-btn--withicon", title: "Yeni ders", onclick: async () => {
        const n = await this.actions.createFolder();
        if (n) this.go(n);
      } }, icon("folder"), h("span", { class: "is-wide", text: "Yeni ders" })),
      h("button", { class: "cm-btn cm-btn--withicon", title: "Yeni not defteri", onclick: () => this.actions.newNotebook() }, icon("notebook"), h("span", { class: "is-wide", text: "Not defteri" })),
      libMore,
      h("button", { class: "cm-btn cm-btn--primary cm-btn--withicon cm-lib__primary", title: `${primaryLabel} (Ctrl O)`, onclick: () => this.actions.pick() }, icon("plus"), h("span", { text: primaryLabel }), kbd("Ctrl O")),
    );
    const totalHl = rows.reduce((a, r) => a + r.highlights, 0);
    const joinStats = (parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

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
      const inRows = rows.filter((r) => r.rec.folder === inFolder);
      const fHl = inRows.reduce((a, r) => a + r.highlights, 0);
      const last = Math.max(0, ...inRows.map((r) => r.rec.lastOpened));
      const tile = h("span", { class: "cm-ctile cm-ctile--lg", "aria-hidden": "true" }, icon("folder"));
      tile.style.setProperty("--hue", String(courseHue(inFolder)));
      this.recent.replaceChildren(
        h("header", { class: "cm-lib__head" },
          h("div", { class: "cm-lib__title" },
            back,
            h("div", { class: "cm-lib__name" },
              tile,
              h("div", {},
                h("h2", { id: "recent-h", tabindex: "-1", class: "cm-lib__h", text: inFolder }),
                h("p", { class: "cm-lib__sub", text: joinStats([`${num(inRows.length)} PDF`, fHl ? `${num(fHl)} vurgu` : null, last ? `son çalışma ${relative(last)}` : null, "PDF'leri buraya sürükleyebilirsin"]) }))),
          ),
          h("div", { class: "cm-lib__actions" },
            h("button", { class: "cm-btn cm-btn--primary cm-btn--withicon cm-lib__primary", onclick: () => this.actions.pick() }, icon("plus"), h("span", { text: "PDF ekle" })),
            more),
        ),
        h("div", { class: "cm-recent__head cm-lib__tools" },
          h("div", { class: "cm-lib__filters" }, ...(filters ? [filters] : [])),
          h("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, search, view),
        ),
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
      const list = rows.filter((r) => r.rec.folder === f).sort((a, b) => b.rec.lastOpened - a.rec.lastOpened);
      const tile = h("span", { class: "cm-ctile", "aria-hidden": "true" }, icon("folder"));
      tile.style.setProperty("--hue", String(courseHue(f)));
      // Sağda en son çalışılan üç PDF'in kapakları yelpaze gibi.
      const stack = h("span", { class: "cm-foldercard__stack", "aria-hidden": "true" });
      list.slice(0, 3).forEach((r, i) => {
        const cover = h("span", { class: "cm-foldercard__cover" });
        cover.style.setProperty("--i", String(i));
        if (!r.rec.lock) void this.actions.thumb(r.rec.hash).then((src) => src && cover.replaceChildren(h("img", { src, alt: "" })));
        stack.append(cover);
      });
      const b = h("button", { class: "cm-foldercard", onclick: () => this.go(f), "aria-label": `${f} dersi, ${s.files} PDF` },
        h("span", { class: "cm-foldercard__body" },
          tile,
          h("span", { class: "cm-foldercard__name", text: f }),
          h("span", { class: "cm-foldercard__meta", text: s.files ? joinStats([`${num(s.files)} PDF`, s.hl ? `${num(s.hl)} vurgu` : null, s.last ? relative(s.last) : null]) : "Henüz PDF yok" }),
        ),
        list.length ? stack : null,
      );
      this.dropTarget(b, f);
      return h("li", {}, b);
    };
    const newCard = h("li", {}, h("button", { class: "cm-foldercard cm-foldercard--new", onclick: async () => {
      const n = await this.actions.createFolder();
      if (n) this.go(n);
    } },
      h("span", { class: "cm-foldercard__body" },
        h("span", { class: "cm-ctile cm-ctile--new", "aria-hidden": "true" }, icon("plus")),
        h("span", { class: "cm-foldercard__name", text: "Yeni ders" }),
        h("span", { class: "cm-foldercard__meta", text: "PDF'lerini bir arada tut" }))));
    const courses = h("section", { class: "cm-courses", "aria-labelledby": "courses-h" },
      h("div", { class: "cm-lib__sect" },
        h("h2", { id: "courses-h", text: "Derslerim" }),
        folders.length ? h("span", { class: "cm-lib__hint cm-courses__hint", text: "Bir PDF'i ders kartına sürükleyerek taşıyabilirsin" }) : null),
      h("ul", { class: "cm-foldergrid", role: "list" }, ...folders.map(card), newCard),
    );
    const lastAll = Math.max(0, ...rows.map((r) => r.rec.lastOpened));
    // Kaldığın yerden devam: en son açılan, erişilebilir ve kilitsiz dosya; tek tıkla kaldığın sayfaya.
    const latest = [...rows].filter((r) => r.reachable).sort((a, b) => b.rec.lastOpened - a.rec.lastOpened)[0];
    const resume = latest ? this.resumeCard(latest) : null;
    this.recent.replaceChildren(
      h("header", { class: "cm-lib__head" },
        h("div", { class: "cm-lib__title" },
          h("h1", { class: "cm-lib__h cm-lib__h--main", text: "Kitaplık" }),
          h("p", { class: "cm-lib__sub", text: joinStats([folders.length ? `${num(folders.length)} ders` : null, `${num(rows.length)} PDF`, totalHl ? `${num(totalHl)} vurgu` : null, lastAll ? `son çalışma ${relative(lastAll)}` : null]) || "PDF'ini buraya sürükle ya da seç" })),
        quick("PDF aç"),
      ),
      ...(resume ? [resume] : []),
      courses,
      ...(rows.length ? [
        h("div", { class: "cm-lib__sect cm-lib__tools" },
          h("h2", { id: "recent-h", text: "Son açılanlar" }),
          h("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, search, view),
        ),
        ...(filters ? [filters] : []),
        content,
      ] : []),
      foot,
    );
  }

  /** "Kaldığın yerden devam" kartı: kapak, ad, ders · sayfa · vurgu, ilerleme; tıklayınca kaldığın sayfada açılır. */
  private resumeCard(row: RecentRow): HTMLElement {
    const { rec } = row;
    const cover = h("span", { class: "cm-resume__cover", "aria-hidden": "true" }, h("span", { class: "cm-file__initial", text: rec.name.replace(/\.pdf$/i, "").slice(0, 1).toUpperCase() }));
    if (rec.cover) cover.style.setProperty("--cover", rec.cover);
    if (rec.lock) cover.append(h("span", { class: "cm-file__lock", text: "🔒" }));
    else void this.actions.thumb(rec.hash).then((src) => src && cover.replaceChildren(h("img", { src, alt: "" })));
    const ratio = rec.pageCount ? Math.min(1, (rec.lastPage + 1) / rec.pageCount) : 0;
    const meta = [rec.folder ?? null, `sayfa ${num(rec.lastPage + 1)} / ${num(rec.pageCount)}`, row.highlights ? `${num(row.highlights)} vurgu` : null, relative(rec.lastOpened)].filter(Boolean).join(" · ");
    return h("button", { class: "cm-resume", "aria-label": `Kaldığın yerden devam: ${rec.name}, sayfa ${rec.lastPage + 1}`, onclick: () => this.actions.openRecent(row) },
      cover,
      h("span", { class: "cm-resume__body" },
        h("span", { class: "cm-resume__kicker", text: "Kaldığın yerden devam" }),
        h("span", { class: "cm-resume__name", text: rec.name.replace(/\.pdf$/i, "") }),
        h("span", { class: "cm-resume__meta", text: meta }),
        h("span", { class: "cm-file__bar" }, h("span", { class: `cm-file__fill${ratio >= 0.999 ? " is-done" : ""}`, style: `width:${Math.max(PROGRESS_MIN, ratio) * 100}%` })),
      ),
      h("span", { class: "cm-resume__go", "aria-hidden": "true" }, "Devam et", icon("back")),
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

  /** Liste görünümü: kapak, ad ve ikinci satırda ders · kaldığın yer · vurgu; ince ilerleme çubuğu; sağda zaman ve menü. */
  private list(rows: RecentRow[], inFolder: boolean): HTMLElement {
    const ul = h("ul", { class: "cm-files", role: "list" });
    for (const row of rows) {
      const { rec } = row;
      const cover = h("span", { class: "cm-file__thumb", "aria-hidden": "true" }, h("span", { class: "cm-file__initial", text: rec.name.replace(/\.pdf$/i, "").slice(0, 1).toUpperCase() }));
      if (rec.cover) cover.style.setProperty("--cover", rec.cover);
      if (rec.lock) cover.append(h("span", { class: "cm-file__lock", text: "🔒" }));
      else void this.actions.thumb(rec.hash).then((src) => src && cover.replaceChildren(h("img", { src, alt: "" })));
      const ratio = rec.pageCount ? Math.min(1, (rec.lastPage + 1) / rec.pageCount) : 0;
      const meta = [
        !inFolder && rec.folder ? rec.folder : null,
        `Sayfa ${num(rec.lastPage + 1)} / ${num(rec.pageCount)}`,
        row.highlights ? `${num(row.highlights)} vurgu` : null,
        ...(rec.tags ?? []).map((t) => `#${t}`),
      ].filter(Boolean).join(" · ");
      const body = h("span", { class: "cm-file__body" },
        h("span", { class: "cm-file__name" },
          rec.pinned ? h("span", { class: "cm-file__pin", title: "Sabitlendi", "aria-label": "sabitlendi", text: "★" }) : null,
          h("span", { text: rec.name.replace(/\.pdf$/i, "") })),
        h("span", { class: "cm-file__meta", text: meta }),
        h("span", { class: "cm-file__bar" }, h("span", { class: `cm-file__fill${ratio >= 0.999 ? " is-done" : ""}`, style: `width:${Math.max(PROGRESS_MIN, ratio) * 100}%` })),
        rec.aliases?.length ? h("span", { class: "cm-file__meta cm-recent__lost", text: `Diğer adları: ${rec.aliases.join(", ")}` }) : null,
        row.reachable ? null : h("span", { class: "cm-file__meta cm-recent__lost", text: "Tarayıcı bu dosyaya erişimi bıraktı. Yeniden seçince vurgular geri gelir." }),
      );
      const main = row.reachable
        ? h("button", { class: "cm-file__open", "aria-label": `${rec.name} dosyasını aç`, onclick: () => this.actions.openRecent(row) }, cover, body)
        : h("span", { class: "cm-file__open is-static" }, cover, body);
      const li = h("li", { class: `cm-file${rec.pinned ? " is-pinned" : ""}` },
        main,
        h("span", { class: "cm-file__time cm-muted", text: relative(rec.lastOpened) }),
        row.reachable
          ? h("span", { class: "cm-file__hint", "aria-hidden": "true", text: rec.lock ? "Kilidi aç" : "Aç" })
          : h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.actions.openRecent(row) }, "Dosyayı yeniden seç"),
        this.more(rec),
      );
      this.draggable(li, rec);
      ul.append(li);
    }
    return ul;
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
