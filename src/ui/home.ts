import { num, relative } from "../format";
import type { FileRecord } from "../types";
import { h, kbd } from "../util";

export const TRUST = "Dosyan bilgisayarından çıkmaz; açma, okuma ve vurgular tamamen bu tarayıcıda işlenir.";

export interface RecentRow {
  rec: FileRecord;
  highlights: number;
  /** Tarayıcı dosyaya hâlâ erişebiliyor mu (yalnızca tutamaç saklanabilen tarayıcılarda). */
  reachable: boolean;
}

export interface HomeActions {
  pick(): void;
  openRecent(row: RecentRow): void;
  clearRecent(): void;
  settings(): void;
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

  constructor(private actions: HomeActions) {
    this.drop = h("section", { class: "cm-drop", "aria-label": "PDF aç" });
    this.dropSlot = h("div", { style: "display:contents" }, this.drop);
    this.recent = h("section", { class: "cm-recent", "aria-labelledby": "recent-h" });
    const bar = h("header", { class: "cm-bar" },
      h("span", { class: "cm-bar__brand", text: "Çalışma Masası" }),
      h("span", { class: "cm-bar__spacer" }),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => actions.settings() }, "Ayarlar"),
    );
    this.el = h("div", { class: "cm-app" }, bar, h("div"), h("main", { class: "cm-home" }, this.dropSlot, this.recent));
    this.showIdle();
  }

  showIdle(): void {
    this.drop.className = "cm-drop";
    this.drop.replaceChildren(
      h("h1", { class: "cm-display", text: "PDF'ini buraya bırak" }),
      h("p", { class: "cm-muted", style: "margin:0", text: "Ders slaytları, kitap bölümleri, çıkmış sorular. Bir seferde bir dosya." }),
      h("div", { style: "display:flex;gap:12px;align-items:center;margin-top:8px" },
        h("button", { class: "cm-btn cm-btn--primary", onclick: () => this.actions.pick() }, "Dosya seç"),
        h("span", { class: "cm-muted" }, kbd("Ctrl O")),
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

  renderRecent(rows: RecentRow[]): void {
    if (!rows.length) {
      this.recent.replaceChildren(
        h("p", { class: "cm-muted", style: "font-size:12px;line-height:16px;margin:0", text: "Vurgular bu tarayıcıda saklanır. Tarayıcı verilerini silersen kaybolur; düzenli olarak Markdown'a aktar." }),
      );
      return;
    }
    const body = h("tbody");
    for (const row of rows) {
      const { rec } = row;
      const name = h("td", {}, h("div", { style: "font-weight:500;overflow-wrap:anywhere", text: rec.name }));
      if (rec.aliases?.length) name.append(h("div", { class: "cm-muted cm-recent__lost", text: `Diğer adları: ${rec.aliases.join(", ")}` }));
      if (!row.reachable) {
        name.append(h("div", { class: "cm-muted cm-recent__lost", text: "Tarayıcı bu dosyaya erişimi bıraktı. Aynı dosyayı seçince vurgular geri gelir." }));
      }
      const open = row.reachable
        ? h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.actions.openRecent(row), "aria-label": `${rec.name} dosyasını aç` }, "Aç")
        : h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.actions.openRecent(row) }, "Dosyayı yeniden seç");
      body.append(
        h("tr", {},
          name,
          h("td", { style: "white-space:nowrap" }, h("span", { class: "cm-num", text: `Sayfa ${num(rec.lastPage + 1)} / ${num(rec.pageCount)}` })),
          h("td", { style: "white-space:nowrap" },
            row.highlights ? h("span", {}, h("span", { class: "cm-num", text: num(row.highlights) }), " vurgu") : h("span", { class: "cm-muted", text: "Vurgu yok" }),
          ),
          h("td", { class: "cm-muted", style: "white-space:nowrap", text: relative(rec.lastOpened) }),
          h("td", {}, open),
        ),
      );
    }
    this.recent.replaceChildren(
      h("div", { class: "cm-recent__head" },
        h("h2", { id: "recent-h", text: "Son açılanlar" }),
        h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.actions.clearRecent() }, "Listeyi temizle"),
      ),
      h("div", { class: "cm-table-wrap" },
        h("table", { class: "cm-table" },
          h("thead", {}, h("tr", {},
            h("th", { text: "Dosya" }), h("th", { style: "white-space:nowrap", text: "Kaldığın yer" }), h("th", { text: "Vurgular" }),
            h("th", { style: "white-space:nowrap", text: "Son açılış" }), h("th", {}),
          )),
          body,
        ),
      ),
      h("p", { class: "cm-muted", style: "font-size:12px;line-height:16px;margin-top:12px", text: "Vurgular bu tarayıcıda saklanır. Tarayıcı verilerini silersen kaybolur; düzenli olarak Markdown'a aktar." }),
    );
  }
}
