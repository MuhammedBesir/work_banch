import { num } from "../format";
import { segment } from "../ai/prompt";
import type { Card, Color, Highlight } from "../types";
import { COLORS } from "../types";
import { h, kbd, marker } from "../util";
import { toast } from "../ui/toast";
import { deck, dueCards, nextLabel, schedule, type Grade } from "./srs";

export interface ReviewActions {
  save(cards: Card[]): void;
  remove(id: string): void;
  /** Kartın kaynağı olan sayfaya git (Tekrar modundan çıkar). */
  source(card: Card): void;
  exit(): void;
}

/**
 * Tekrar modu: tam ekran, araç çubuğu tek satır. Tanım (ve seçilen diğer renk) vurguları kendiliğinden kart olur;
 * AI kartları onaylanmadan desteye girmez. `Space` cevabı açar, `1`–`3` derecelendirir.
 */
export class ReviewScreen {
  readonly el: HTMLElement;
  private main: HTMLElement;
  private chips: HTMLElement;
  private counter: HTMLElement;
  private colors = new Set<Color>([2, 4]);
  private includeAi = true;
  private view: "review" | "suggestions" = "review";
  private queue: Card[] = [];
  private index = 0;
  private done = 0;
  private revealed = false;
  private editing = false;
  private cram = false;

  constructor(
    title: string,
    private names: Record<Color, string>,
    private cards: Card[],
    private highlights: Highlight[],
    private actions: ReviewActions,
  ) {
    this.chips = h("div", { class: "cm-chips", role: "group", "aria-label": "Deste" });
    this.counter = h("span", { class: "cm-num" });
    const bar = h("header", { class: "cm-bar", role: "toolbar", "aria-label": "Tekrar" },
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => actions.exit() }, "‹ Belgeye dön ", kbd("Esc")),
      h("span", { class: "cm-bar__brand", text: `Tekrar · ${title}` }),
      h("span", { class: "cm-bar__spacer" }),
      this.chips,
      h("span", { class: "cm-bar__sep" }),
      this.counter,
    );
    this.main = h("main", { class: "cm-review", "aria-live": "polite" });
    this.el = h("div", { class: "cm-review-screen" }, bar, this.main);
    this.el.addEventListener("keydown", this.onKey);
    // Odak henüz ekrana geçmeden basılan tuşlar da (Firefox, Safari) ekrana gelsin.
    document.addEventListener("keydown", this.onDocKey, true);
    this.build();
  }

  private onDocKey = (e: KeyboardEvent) => {
    if (!this.el.isConnected) {
      document.removeEventListener("keydown", this.onDocKey, true);
      return;
    }
    const t = e.target as HTMLElement;
    if (this.el.contains(t) || t.closest?.("input, textarea, [contenteditable], .cm-dialog")) return;
    this.onKey(e);
  };

  destroy(): void {
    document.removeEventListener("keydown", this.onDocKey, true);
    this.el.remove();
  }

  focus(): void {
    (this.main.querySelector<HTMLElement>("[data-autofocus]") ?? this.main.querySelector<HTMLElement>("button") ?? this.main).focus();
  }

  get suggestions(): Card[] {
    return this.cards.filter((c) => c.status === "suggested");
  }

  /** Desteyi kur: seçili renklerin kartları (eksikler oluşturulup kaydedilir) ve vadesi gelenler. */
  private build(): void {
    const { cards, created } = deck(this.cards, this.highlights, this.colors, this.includeAi);
    if (created.length) {
      this.cards.push(...created);
      this.actions.save(created);
    }
    this.queue = this.cram ? [...cards].sort((a, b) => a.due - b.due) : dueCards(cards);
    this.index = 0;
    this.done = 0;
    this.revealed = false;
    this.renderChips();
    this.render();
  }

  private renderChips(): void {
    const chip = (label: Node[], on: boolean, onclick: () => void) =>
      h("button", { class: `cm-chip${on ? " is-on" : ""}`, "aria-pressed": String(on), onclick }, ...label);
    const n = this.suggestions.length;
    this.chips.replaceChildren(
      ...COLORS.map((c) => chip([marker(c), document.createTextNode(this.names[c])], this.colors.has(c) && this.view === "review", () => {
        this.view = "review";
        if (this.colors.has(c)) this.colors.delete(c);
        else this.colors.add(c);
        this.build();
      })),
      chip([document.createTextNode("AI önerileri "), h("span", { class: "cm-num", text: num(n) })], this.view === "suggestions", () => {
        this.view = this.view === "suggestions" ? "review" : "suggestions";
        this.renderChips();
        this.render();
      }),
    );
  }

  private render(): void {
    if (this.view === "suggestions") return this.renderSuggestions();
    const total = this.queue.length;
    this.counter.textContent = total ? `${num(Math.min(this.done, total))} / ${num(total)} · ${this.cram ? "tümü" : "bugün"}` : "";
    const card = this.queue[this.index];
    if (!card) return this.renderEmpty();
    const progress = h("div", { class: "cm-progress", role: "progressbar", "aria-valuenow": this.done, "aria-valuemax": total, "aria-label": "Bugünkü kartlar" }, h("div"));
    (progress.firstChild as HTMLElement).style.width = `${(this.done / Math.max(1, total)) * 100}%`;
    const src = h("div", { class: "cm-card__src" },
      card.color ? marker(card.color) : h("span", { class: "cm-kind", text: "AI" }),
      h("span", { text: `${card.color ? this.names[card.color] : "AI kartı"} · s. ${num(card.page + 1)}` }),
      h("span", { text: "·" }),
      h("span", { text: card.source === "ai" ? "AI önerisi, senin onayınla" : "vurgundan otomatik" }),
    );
    const article = h("article", { class: "cm-card", "aria-label": "Kart", tabindex: "-1" }, src);
    if (this.editing) {
      const front = h("textarea", { class: "cm-input cm-card__edit", rows: 2, "aria-label": "Ön yüz", "data-autofocus": "" });
      const back = h("textarea", { class: "cm-input cm-card__edit", rows: 4, "aria-label": "Arka yüz" });
      front.value = card.front;
      back.value = card.back;
      const save = () => {
        card.front = front.value.trim() || card.front;
        card.back = back.value.trim() || card.back;
        card.updatedAt = Date.now();
        this.actions.save([card]);
        this.editing = false;
        this.render();
      };
      [front, back].forEach((t) => t.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") (this.editing = false), this.render();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
      }));
      article.append(front, back, h("div", { style: "display:flex;gap:8px" },
        h("button", { class: "cm-btn cm-btn--primary cm-btn--sm", onclick: save }, "Kaydet ", kbd("Ctrl Enter")),
        h("button", { class: "cm-btn cm-btn--sm", onclick: () => ((this.editing = false), this.render()) }, "Vazgeç"),
        h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--danger", onclick: () => this.removeCurrent() }, "Kartı sil"),
      ));
    } else {
      article.append(h("p", { class: "cm-card__q", text: card.front }));
      if (this.revealed) {
        const a = h("p", { class: "cm-card__a" });
        // AI kartında kaynak etiketi sade "(s. N)" olur.
        for (const s of segment(card.back)) {
          a.append(s.text, ...s.cites.map((c) => ` (s. ${c.page + 1})`), " ");
        }
        article.append(a);
        if (card.note) article.append(h("div", { class: "cm-card__src", style: "margin-top:auto" }, h("span", { text: `Notun: ${card.note}` })));
      }
    }
    const grade = (g: Grade, label: string) =>
      h("button", { class: "cm-btn", disabled: !this.revealed || this.editing, onclick: () => this.grade(g), "data-autofocus": this.revealed && g === 3 ? "" : undefined },
        h("span", {}, `${label} `, kbd(String(g))), h("span", { class: "cm-num cm-muted", text: nextLabel(card, g) }));
    const reveal = h("button", { class: "cm-btn cm-btn--primary", onclick: () => this.reveal(), "data-autofocus": this.revealed ? undefined : "" }, "Cevabı göster ", kbd("Space"));
    this.main.replaceChildren(
      progress,
      article,
      this.revealed ? h("div", { class: "cm-grade", role: "group", "aria-label": "Ne kadar hatırladın" }, grade(1, "Bilemedim"), grade(2, "Zorlandım"), grade(3, "Bildim")) : reveal,
      h("p", { class: "cm-muted", style: "margin:0;font-size:13px" }, "Cevap ", kbd("Space"), " · Kaynağa git ", kbd("G"), " · Kartı düzenle ", kbd("E")),
    );
    requestAnimationFrame(() => this.focus());
  }

  private renderEmpty(): void {
    const all = deck(this.cards, this.highlights, this.colors, this.includeAi).cards;
    const next = all.filter((c) => c.status === "active").sort((a, b) => a.due - b.due)[0];
    const when = next ? new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(next.due) : null;
    this.main.replaceChildren(
      h("div", { class: "cm-panel__empty", style: "max-width:520px;text-align:center;align-items:center" },
        h("h3", { text: all.length ? (this.done ? "Bugünlük bitti" : "Bugün tekrar edilecek kart yok") : "Bu destede kart yok" }),
        h("p", { class: "cm-muted", style: "margin:0", text: all.length
          ? `${num(all.length)} kart · sıradaki: ${when ?? "—"}`
          : "Seçili renklerde vurgu yok. Üstten başka bir renk seç ya da sayfada metni vurgula; Tanım vurguları kendiliğinden kart olur." }),
        all.length ? h("button", { class: "cm-btn", "data-autofocus": "", onclick: () => ((this.cram = true), this.build()) }, "Tümünü yine de çalış") : null,
        this.suggestions.length ? h("button", { class: "cm-btn cm-btn--ghost", onclick: () => ((this.view = "suggestions"), this.renderChips(), this.render()) }, `${num(this.suggestions.length)} AI kart önerisi onayını bekliyor`) : null,
      ),
    );
    this.counter.textContent = "";
    requestAnimationFrame(() => this.focus());
  }

  /** AI kartları kullanıcı onaylamadan desteye girmez: yanlış bir kartı ezberlemek hiç çalışmamaktan kötü. */
  private renderSuggestions(): void {
    const list = this.suggestions;
    this.counter.textContent = "";
    if (!list.length) {
      this.main.replaceChildren(h("div", { class: "cm-panel__empty", style: "max-width:520px;text-align:center;align-items:center" },
        h("h3", { text: "Onay bekleyen öneri yok" }),
        h("p", { class: "cm-muted", style: "margin:0", text: "AI panelinde \"Kart öner\" ile Anlamadım ve Tanım vurgularından kart önerisi alabilirsin." })));
      return;
    }
    const rows = list.map((c) => {
      const front = h("textarea", { class: "cm-input cm-card__edit", rows: 2, "aria-label": "Ön yüz" });
      const back = h("textarea", { class: "cm-input cm-card__edit", rows: 3, "aria-label": "Arka yüz" });
      front.value = c.front;
      back.value = c.back;
      [front, back].forEach((t) => t.addEventListener("keydown", (e) => e.stopPropagation()));
      const commit = (approve: boolean) => {
        if (!approve) {
          this.cards = this.cards.filter((x) => x.id !== c.id);
          this.actions.remove(c.id);
        } else {
          Object.assign(c, { front: front.value.trim() || c.front, back: back.value.trim() || c.back, status: "active", due: Date.now(), updatedAt: Date.now() });
          this.actions.save([c]);
        }
        this.renderChips();
        this.renderSuggestions();
      };
      return h("div", { class: "cm-suggest" },
        h("div", { class: "cm-card__src" }, h("span", { class: "cm-kind", text: "AI" }), h("span", { text: `s. ${num(c.page + 1)}` })),
        front, back,
        h("div", { style: "display:flex;gap:8px" },
          h("button", { class: "cm-btn cm-btn--sm", onclick: () => commit(true) }, "Onayla"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--danger", onclick: () => commit(false) }, "Sil"),
        ),
      );
    });
    this.main.replaceChildren(
      h("div", { class: "cm-suggest__list" },
        h("div", { style: "display:flex;justify-content:space-between;align-items:center" },
          h("p", { class: "cm-label", style: "margin:0", text: `${num(list.length)} öneri · kontrol et, düzelt, onayla` }),
          h("button", { class: "cm-btn cm-btn--sm", onclick: () => {
            for (const c of list) Object.assign(c, { status: "active", due: Date.now(), updatedAt: Date.now() });
            this.actions.save(list);
            toast(`${num(list.length)} kart desteye eklendi`);
            this.view = "review";
            this.build();
          } }, "Tümünü onayla")),
        ...rows,
      ),
    );
  }

  private reveal(): void {
    if (this.revealed || !this.queue[this.index]) return;
    this.revealed = true;
    this.render();
  }

  private grade(g: Grade): void {
    const card = this.queue[this.index];
    if (!card || !this.revealed) return;
    Object.assign(card, schedule(card, g), { updatedAt: Date.now() });
    this.actions.save([card]);
    this.done++;
    // Bilemediğin kart bu oturumda sona yeniden eklenir.
    if (g === 1) this.queue.push(card);
    this.index++;
    this.revealed = false;
    this.render();
  }

  private removeCurrent(): void {
    const card = this.queue[this.index];
    if (!card) return;
    this.queue.splice(this.index, 1);
    this.cards = this.cards.filter((x) => x.id !== card.id);
    this.actions.remove(card.id);
    this.editing = false;
    this.render();
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
    const card = this.queue[this.index];
    const key = e.key.toLowerCase();
    if (e.key === "Escape") this.actions.exit();
    else if (this.view !== "review") return;
    else if (e.key === " " && !this.revealed) this.reveal();
    else if (/^[123]$/.test(e.key) && this.revealed) this.grade(Number(e.key) as Grade);
    else if (key === "g" && card) this.actions.source(card);
    else if (key === "e" && card) ((this.editing = true), this.render());
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
}
