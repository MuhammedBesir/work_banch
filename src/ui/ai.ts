import { contextChars, plainText, segment, type AiContext, type Cite, type Turn } from "../ai/prompt";
import { num } from "../format";
import type { AiSettings } from "../types";
import { AI_MODELS } from "../types";
import { h, kbd, marker } from "../util";
import { toast } from "./toast";

export type Scope = "selection" | "page" | "section" | "highlights" | "hl2" | "hl4";

export interface AiActions {
  settings(): AiSettings;
  /** Kapsamın metni; olmazsa nedeni. */
  context(scope: Scope): Promise<AiContext | { error: string }>;
  counts(): { selection: boolean; hl2: number; hl4: number };
  /** Kaynak etiketinin üstüne gelince sayfadaki dayanak metni göster / gizle. */
  citeHover(c: Cite | null): void;
  citeJump(c: Cite): void;
  addNote(page: number, text: string): void;
  openSettings(): void;
}

const SCOPES: [Scope, string][] = [["selection", "Seçim"], ["page", "Bu sayfa"], ["section", "Bölüm"], ["highlights", "Vurgularım"]];

/**
 * AI paneli: ayrı bir sohbet ekranı değil, İşaretler'in yanında bir sekme.
 * Gönderilecek metin ve karakter sayısı her istekte Sor düğmesinin altında görünür; kullanıcı göndermeden kırpabilir.
 */
export class AiPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private quick: HTMLElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private sentLine: HTMLElement;
  private preview: HTMLTextAreaElement;
  private scopeSeg: HTMLElement;
  private mode: HTMLElement;
  private scope: Scope = "page";
  private ctx: AiContext | null = null;
  private edited = false;
  private history: Turn[] = [];
  private abort: AbortController | null = null;
  private previewRun = 0;

  constructor(private actions: AiActions) {
    this.mode = h("span", { class: "cm-ai__mode cm-ai__mode--cloud" });
    this.quick = h("div", { class: "cm-quick", role: "group", "aria-label": "Hızlı istekler" });
    this.list = h("div", { class: "cm-list cm-ai__list", "aria-live": "polite" });
    this.scopeSeg = h("div", { class: "cm-seg cm-seg--sm", role: "group", "aria-label": "Kapsam" });
    this.input = h("input", { class: "cm-input", placeholder: "Bu belgeye sor…", "aria-label": "AI'ya sor" });
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") (e.preventDefault(), this.submit());
      else if (e.key === "Escape") (e.preventDefault(), this.stop());
    });
    this.sendBtn = h("button", { class: "cm-btn cm-btn--primary", onclick: () => (this.abort ? this.stop() : this.submit()) }, "Sor");
    this.preview = h("textarea", { class: "cm-ai__preview", "aria-label": "Gönderilecek metin (kırpabilirsin)", hidden: true, rows: 6 });
    this.preview.addEventListener("input", () => {
      this.edited = true;
      this.renderSent();
    });
    this.preview.addEventListener("keydown", (e) => e.stopPropagation());
    this.sentLine = h("div", { class: "cm-ai__sent" });
    const head = h("div", { class: "cm-panel__head" }, h("div", { class: "cm-panel__title" }, h("span", { text: "AI" }), this.mode));
    const send = h("div", { class: "cm-ai__send" },
      h("div", { class: "cm-field", style: "justify-content:space-between;flex-wrap:wrap;gap:6px" }, h("span", { class: "cm-muted", style: "font-size:12px", text: "Kapsam" }), this.scopeSeg),
      h("div", { style: "display:flex;gap:6px" }, this.input, this.sendBtn),
      this.sentLine,
      this.preview,
    );
    this.el = h("aside", { class: "cm-panel cm-ai", "aria-label": "AI" }, head, this.list, send);
    this.renderScope();
    this.renderEmpty();
  }

  /** Paneli göstermeden önce: kapsamı, sayıları ve gönderilecek satırını tazele. */
  refresh(): void {
    const s = this.actions.settings();
    const model = AI_MODELS.find(([id]) => id === s.model)?.[1].replace(/ \(.*\)$/, "") ?? s.model;
    this.mode.textContent = `Bulut · ${model}`;
    this.renderQuick();
    void this.loadPreview();
  }

  /** Seçim araç çubuğundaki Sor (A): seçim kapsam olarak girişe yerleşir, imleç girişte. */
  askAboutSelection(): void {
    this.setScope("selection");
    this.input.focus();
  }

  focus(): void {
    this.input.focus();
  }

  /** Sayfa değişince "Bu sayfa" kapsamı da değişir. */
  pageChanged(): void {
    if ((this.scope === "page" || this.scope === "section") && !this.abort) void this.loadPreview();
  }

  selectionChanged(): void {
    if (this.scope === "selection" && !this.abort) void this.loadPreview();
  }

  private setScope(s: Scope): void {
    this.scope = s;
    this.renderScope();
    void this.loadPreview();
  }

  private renderScope(): void {
    this.scopeSeg.replaceChildren(...SCOPES.map(([s, label]) =>
      h("button", { class: this.scope === s ? "is-on" : "", "aria-pressed": String(this.scope === s), onclick: () => this.setScope(s) }, label)));
  }

  private renderQuick(): void {
    const c = this.actions.counts();
    const chip = (label: Node[], scope: Scope, q: string, disabled = false) =>
      h("button", { class: "cm-chip", disabled, onclick: () => this.run(q, scope) }, ...label);
    this.quick.replaceChildren(
      chip([document.createTextNode("Bu sayfayı özetle")], "page", "Bu sayfayı kısa maddeler halinde özetle."),
      chip([marker(2), document.createTextNode(" Anlamadıklarımı açıkla "), h("span", { class: "cm-num", text: num(c.hl2) })], "hl2",
        "\"Anlamadım\" olarak işaretlediğim yerleri tek tek, basitçe ve birer örnekle açıkla.", c.hl2 === 0),
      chip([document.createTextNode("Sınav sorusu üret")], "page", "Bu sayfadan 3 sınav sorusu üret. Her birinin altına kısa cevabını ve kaynağını yaz."),
      chip([marker(4), document.createTextNode(" Tanımları açıkla "), h("span", { class: "cm-num", text: num(c.hl4) })], "hl4",
        "\"Tanım\" olarak işaretlediğim tanımları kendi cümlelerinle, birer örnekle açıkla.", c.hl4 === 0),
    );
  }

  private renderEmpty(): void {
    this.list.replaceChildren(
      this.quick,
      h("p", { class: "cm-muted", style: "margin:0;font-size:13px;line-height:18px" },
        "Kapsamı seç, sorunu yaz. Cevaptaki her iddia sayfa etiketiyle gelir; etikete gelince dayandığı metin sayfada gösterilir. ",
        kbd("Ctrl J"), " paneli açar, seçimdeyken ", kbd("A"), " seçimi sorar."),
    );
  }

  private async loadPreview(): Promise<void> {
    const run = ++this.previewRun;
    this.sentLine.textContent = "Gönderilecek metin hazırlanıyor…";
    const ctx = await this.actions.context(this.scope);
    if (run !== this.previewRun) return;
    if ("error" in ctx) {
      this.ctx = null;
      this.sentLine.replaceChildren(h("span", { class: "cm-ai__err", text: ctx.error }));
      this.preview.hidden = true;
      return;
    }
    this.ctx = ctx;
    this.edited = false;
    this.preview.value = ctx.pages.map((p) => p.text.trim()).join("\n\n");
    this.renderSent();
  }

  /** Gönderilecek: sayfa 112 metni · 1.240 karakter — her istekte, Sor'un hemen altında. */
  private renderSent(): void {
    if (!this.ctx) return;
    const chars = this.edited ? this.preview.value.trim().length : contextChars(this.ctx);
    const toggle = h("button", { class: "cm-linkbtn", "aria-expanded": String(!this.preview.hidden), onclick: () => {
      this.preview.hidden = !this.preview.hidden;
      this.renderSent();
    } }, this.preview.hidden ? "Göster" : "Gizle");
    this.sentLine.replaceChildren(
      "Gönderilecek: ",
      h("b", { text: `${this.ctx.label}${this.edited ? " (kırpıldı)" : ""} · ${num(chars)} karakter` }),
      " ",
      toggle,
    );
  }

  /** Gönderilecek kapsam: kullanıcı önizlemeyi kırptıysa kırpılmış metin. */
  private outgoing(): AiContext | null {
    if (!this.ctx) return null;
    if (!this.edited) return this.ctx;
    const page = this.ctx.pages[0]?.page ?? 0;
    return { label: `${this.ctx.label} (kırpıldı)`, pages: [{ page, text: this.preview.value }] };
  }

  private submit(): void {
    const q = this.input.value.trim();
    if (!q) {
      this.input.focus();
      return;
    }
    this.input.value = "";
    void this.run(q, this.scope, true);
  }

  private stop(): void {
    this.abort?.abort();
  }

  private async run(question: string, scope: Scope, useCurrent = false): Promise<void> {
    if (this.abort) return;
    const s = this.actions.settings();
    if (!s.apiKey) {
      toast("Önce Ayarlar > AI'dan API anahtarını gir.");
      this.actions.openSettings();
      return;
    }
    let ctx: AiContext | null;
    if (useCurrent || scope === this.scope) {
      ctx = this.outgoing();
    } else {
      const c = await this.actions.context(scope);
      if ("error" in c) {
        toast(c.error);
        return;
      }
      ctx = c;
    }
    if (!ctx) {
      toast("Bu kapsamda gönderilecek metin yok. Başka bir kapsam seç.");
      return;
    }
    if (!this.history.length && this.list.querySelector(".cm-ai__turn") === null) this.list.replaceChildren(this.quick);

    const turn = h("div", { class: "cm-ai__turn" },
      h("div", { style: "display:flex;flex-direction:column" },
        h("div", { class: "cm-ai__ctx", style: "align-self:flex-end", text: `${ctx.label} · ${num(contextChars(ctx))} karakter gönderildi` }),
        h("div", { class: "cm-ai__q", text: question }),
      ),
    );
    const answer = h("div", { class: "cm-ai__a" }, h("p", { class: "cm-muted", text: "Düşünüyor…" }));
    turn.append(answer);
    this.list.append(turn);
    turn.scrollIntoView({ block: "end" });

    this.abort = new AbortController();
    this.sendBtn.textContent = "Durdur";
    this.sendBtn.classList.remove("cm-btn--primary");
    let text = "";
    let frame = 0;
    const client = await import("../ai/client"); // SDK yalnızca AI kullanılınca yüklenir
    try {
      const res = await client.ask({
        apiKey: s.apiKey,
        model: s.model,
        history: this.history,
        ctx,
        question,
        signal: this.abort.signal,
        onText: (d) => {
          text += d;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => this.renderAnswer(answer, text, false));
        },
      });
      cancelAnimationFrame(frame);
      if (res.stop === "refusal") {
        this.renderError(answer, { title: "AI bu isteği cevaplamadı", text: "Soruyu ya da kapsamı değiştirip yeniden dene." });
      } else {
        this.renderAnswer(answer, res.text, true);
        this.history.push({ question, answer: res.text });
        turn.append(this.answerActions(res.text, question, scope));
        if (res.stop === "max_tokens") answer.append(h("p", { class: "cm-muted", text: "Cevap uzunluk sınırında kesildi." }));
      }
    } catch (err) {
      cancelAnimationFrame(frame);
      if (text) this.renderAnswer(answer, text, true);
      this.renderError(answer, client.friendlyError(err), !!text);
      if (text) turn.append(this.answerActions(text, question, scope));
    } finally {
      this.abort = null;
      this.sendBtn.textContent = "Sor";
      this.sendBtn.classList.add("cm-btn--primary");
      if (!this.list.querySelector(".cm-ai__warn")) {
        this.list.append(h("p", { class: "cm-muted cm-ai__warn", style: "margin:0;font-size:12px;line-height:16px", text: "AI yanılabilir. Sadece kaynak gösterdiği yerlere güven; kaynağı olmayan (soluk) cümleyi kontrol et." }));
      } else {
        this.list.append(this.list.querySelector(".cm-ai__warn")!);
      }
    }
  }

  private renderError(answer: HTMLElement, e: { title: string; text: string }, keep = false): void {
    const box = h("div", { class: "cm-notice cm-notice--err", role: "alert" },
      h("span", { class: "cm-notice__sym", "aria-hidden": "true", text: "×" }),
      h("div", {}, h("p", { class: "cm-notice__title", text: e.title }), h("p", { class: "cm-notice__text", style: "margin:0", text: e.text })),
    );
    if (keep) answer.append(box);
    else answer.replaceChildren(box);
  }

  /** Cevap: paragraflar ve maddeler; her kaynak bir sayfa etiketi, kaynaksız cümle soluk. */
  private renderAnswer(el: HTMLElement, text: string, final: boolean): void {
    const frag = document.createDocumentFragment();
    let list: HTMLUListElement | null = null;
    for (const block of text.split(/\n{2,}/)) {
      for (const line of block.split("\n")) {
        if (!line.trim()) continue;
        const bullet = /^\s*[-•*]\s+/.test(line);
        const p = bullet ? h("li") : h("p");
        for (const s of segment(line.replace(/^\s*[-•*]\s+/, ""))) {
          const span = h("span", { class: final && !s.cites.length ? "cm-ai__nosrc" : "" }, s.text);
          for (const c of s.cites) span.append(" ", this.citeChip(c));
          p.append(span, " ");
        }
        if (bullet) {
          list ??= frag.appendChild(h("ul"));
          list.append(p);
        } else {
          list = null;
          frag.append(p);
        }
      }
      list = null;
    }
    el.replaceChildren(frag);
  }

  private citeChip(c: Cite): HTMLElement {
    const b = h("button", { class: "cm-src", title: c.quote ? `„${c.quote}"` : `Sayfa ${c.page + 1}`, onclick: () => this.actions.citeJump(c) }, `s. ${num(c.page + 1)}`);
    b.addEventListener("mouseenter", () => this.actions.citeHover(c));
    b.addEventListener("focus", () => this.actions.citeHover(c));
    b.addEventListener("mouseleave", () => this.actions.citeHover(null));
    b.addEventListener("blur", () => this.actions.citeHover(null));
    return b;
  }

  /** AI çıktısı kullanıcının verisine onaysız girmez: not yalnızca açık bir tıkla ve "AI" etiketiyle eklenir. */
  private answerActions(text: string, question: string, scope: Scope): HTMLElement {
    const cites = segment(text.replace(/\n/g, " ")).flatMap((s) => s.cites);
    const page = cites[0]?.page ?? this.ctx?.pages[0]?.page ?? 0;
    return h("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
      h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.actions.addNote(page, plainText(text)) }, "Not olarak ekle"),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => navigator.clipboard.writeText(plainText(text)).then(() => toast("Kopyalandı"), () => toast("Kopyalanamadı")) }, "Kopyala"),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => {
        this.history = this.history.filter((t) => t.answer !== text);
        void this.run(question, scope);
      } }, "Yeniden üret"),
    );
  }
}
