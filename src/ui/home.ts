import { fold, num, relative } from "../format";
import type { FileRecord } from "../types";
import { h, kbd } from "../util";
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
}

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
      h("span", { class: "cm-bar__brand", text: "Çalışma Masası" }),
      h("span", { class: "cm-bar__spacer" }),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => actions.settings() }, "Ayarlar"),
    );
    this.el = h("div", { class: "cm-app" }, bar, h("div"), h("main", { class: "cm-home" }, this.dropSlot, this.notice, this.recent));
    this.showIdle();
  }

  showIdle(): void {
    this.drop.className = "cm-drop";
    this.drop.replaceChildren(
      h("h1", { class: "cm-display", text: "PDF'ini buraya bırak" }),
      h("p", { class: "cm-muted", style: "margin:0", text: "Ders slaytları, kitap bölümleri, çıkmış sorular. Bir seferde bir dosya." }),
      h("div", { style: "display:flex;gap:12px;align-items:center;margin-top:8px;flex-wrap:wrap;justify-content:center" },
        h("button", { class: "cm-btn cm-btn--primary", onclick: () => this.actions.pick() }, "Dosya seç"),
        h("span", { class: "cm-muted" }, kbd("Ctrl O")),
        h("button", { class: "cm-btn", onclick: () => this.actions.newNotebook() }, "Yeni not defteri"),
        h("button", { class: "cm-btn cm-btn--ghost", onclick: () => this.actions.importBundle() }, "Paylaşım paketi aç"),
      ),
      h("p", { class: "cm-trust", style: "margin:16px 0 0", text: TRUST }),
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
  private folder: string = "*";
  private tag = "";
  private query = "";

  renderRecent(rows: RecentRow[]): void {
    this.rows = rows;
    const foot = h("p", { class: "cm-muted", style: "font-size:12px;line-height:16px;margin-top:12px", text: "Vurgular bu tarayıcıda saklanır. Tarayıcı verilerini silersen kaybolur; düzenli olarak yedek al ya da Markdown'a aktar." });
    if (!rows.length) {
      this.recent.replaceChildren(foot);
      return;
    }
    const folders = [...new Set(rows.map((r) => r.rec.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, "tr"));
    const tags = [...new Set(rows.flatMap((r) => r.rec.tags ?? []))].sort((a, b) => a.localeCompare(b, "tr"));
    if (this.folder !== "*" && this.folder !== "pinned" && this.folder !== "" && !folders.includes(this.folder)) this.folder = "*";
    if (this.tag && !tags.includes(this.tag)) this.tag = "";
    const q = fold(this.query.trim());
    const shown = rows
      .filter((r) => this.folder === "*" || (this.folder === "pinned" ? r.rec.pinned : (r.rec.folder ?? "") === this.folder))
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
      this.renderRecent(this.rows);
      const again = this.recent.querySelector<HTMLInputElement>(".cm-recent__search");
      again?.focus();
      if (at !== null) again?.setSelectionRange(at, at);
    });
    const filters = h("div", { class: "cm-recent__filters", role: "group", "aria-label": "Klasör ve etiket" },
      chip("Tümü", this.folder === "*", () => ((this.folder = "*"), this.renderRecent(this.rows))),
      rows.some((r) => r.rec.pinned) ? chip("★ Sabitlenenler", this.folder === "pinned", () => ((this.folder = "pinned"), this.renderRecent(this.rows))) : null,
      ...folders.map((f) => chip(`▸ ${f}`, this.folder === f, () => ((this.folder = f), this.renderRecent(this.rows)))),
      folders.length ? chip("Klasörsüz", this.folder === "", () => ((this.folder = ""), this.renderRecent(this.rows))) : null,
      ...tags.map((t) => chip(`#${t}`, this.tag === t, () => ((this.tag = this.tag === t ? "" : t), this.renderRecent(this.rows)))),
    );
    const view = h("div", { class: "cm-seg cm-seg--sm", role: "group", "aria-label": "Görünüm" },
      h("button", { class: this.actions.view === "list" ? "is-on" : "", "aria-pressed": String(this.actions.view === "list"), onclick: () => this.actions.setView("list") }, "Liste"),
      h("button", { class: this.actions.view === "grid" ? "is-on" : "", "aria-pressed": String(this.actions.view === "grid"), onclick: () => this.actions.setView("grid") }, "Kapaklar"),
    );
    const content = !shown.length
      ? h("p", { class: "cm-muted", text: "Bu filtrede dosya yok." })
      : this.actions.view === "grid" ? this.grid(shown) : this.table(shown);
    this.recent.replaceChildren(
      h("div", { class: "cm-recent__head" },
        h("h2", { id: "recent-h", text: "Son açılanlar" }),
        h("div", { style: "display:flex;gap:8px;align-items:center" }, search, view,
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.actions.clearRecent() }, "Listeyi temizle")),
      ),
      filters,
      content,
      foot,
    );
  }

  private menu(anchor: HTMLElement, rec: FileRecord): void {
    const items: (MenuItem | "sep")[] = [
      { label: rec.pinned ? "Sabitlemeyi kaldır" : "Başa sabitle", run: () => this.actions.organize(rec, "pin") },
      { label: "Klasöre taşı…", hint: rec.folder ?? "", run: () => this.actions.organize(rec, "folder") },
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
      ...(rec.folder ? [h("span", { class: "cm-tag", text: rec.folder })] : []),
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
      body.append(
        h("tr", {},
          name,
          h("td", { style: "white-space:nowrap" }, h("span", { class: "cm-num", text: `Sayfa ${num(rec.lastPage + 1)} / ${num(rec.pageCount)}` })),
          h("td", { style: "white-space:nowrap" },
            row.highlights ? h("span", {}, h("span", { class: "cm-num", text: num(row.highlights) }), " vurgu") : h("span", { class: "cm-muted", text: "Vurgu yok" }),
          ),
          h("td", { class: "cm-muted", style: "white-space:nowrap", text: relative(rec.lastOpened) }),
          h("td", { style: "white-space:nowrap" }, this.openButton(row), this.more(rec)),
        ),
      );
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
      grid.append(h("li", { class: "cm-cover" },
        open,
        h("div", { class: "cm-cover__meta" },
          h("div", { class: "cm-cover__title", title: rec.name, text: rec.name.replace(/\.pdf$/i, "") }),
          this.more(rec),
        ),
        h("div", { class: "cm-cover__sub cm-muted cm-num", text: `${num(rec.lastPage + 1)}/${num(rec.pageCount)} · ${row.highlights ? `${num(row.highlights)} vurgu` : relative(rec.lastOpened)}` }),
        h("div", { class: "cm-cover__badges" }, ...this.badges(rec)),
        row.reachable ? null : h("div", { class: "cm-muted cm-recent__lost", text: "Dosyayı yeniden seçmen gerekiyor." }),
      ));
    }
    return grid;
  }
}
