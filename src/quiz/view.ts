import { h } from "../util";
import { icon } from "../ui/icons";
import { renderMathIn } from "../ui/math";
import { checkText, type Quiz, type QuizQuestion } from "./quiz";

export interface QuizActions {
  create(): void;
  remove(id: string): void;
  goTo(page: number): void;
  exportMd(qz: Quiz): void;
  toCards(qz: Quiz): void;
  aiReady(): boolean;
  openAiSettings(): void;
}

type Given = number | boolean | string | undefined;

/**
 * Belgenin son sayfasının altında: "AI ile quiz oluştur" ve oluşturulan quizler (etkileşimli).
 * Şıkkı seç, Kontrol et ile puanını gör; açıklama ve dayandığı sayfa her sorunun altında.
 */
export class QuizSection {
  readonly el = h("section", { class: "cm-quizzes", "aria-label": "Quizler" });
  private given = new Map<string, Given[]>();
  private checked = new Set<string>();
  private quizzes: Quiz[] = [];
  private busy = "";

  constructor(private actions: QuizActions) {}

  setBusy(text: string): void {
    this.busy = text;
    this.render(this.quizzes);
  }

  render(quizzes: Quiz[]): void {
    this.quizzes = quizzes;
    const head = h("div", { class: "cm-quizzes__head" },
      h("div", {},
        h("h2", { class: "cm-quizzes__title" }, icon("quiz"), " Kendini sına"),
        h("p", { class: "cm-muted", style: "margin:0", text: "Bu belgeden AI ile istediğin biçimde quiz hazırla: soru tipi, sayısı, zorluğu ve kapsamı senin." }),
      ),
      this.actions.aiReady()
        ? h("button", { class: "cm-btn cm-btn--primary", disabled: !!this.busy, onclick: () => this.actions.create() }, this.busy ? "Hazırlanıyor…" : "AI ile quiz oluştur")
        : h("button", { class: "cm-btn", onclick: () => this.actions.openAiSettings() }, "Quiz için AI'yı aç"),
    );
    this.el.replaceChildren(head,
      ...(this.busy ? [h("p", { class: "cm-muted cm-quizzes__busy", role: "status", text: this.busy })] : []),
      ...[...quizzes].reverse().map((qz) => this.card(qz)));
    renderMathIn(this.el);
  }

  private card(qz: Quiz): HTMLElement {
    const given = this.given.get(qz.id) ?? (this.given.set(qz.id, []), this.given.get(qz.id)!);
    const checked = this.checked.has(qz.id);
    const scored = qz.questions.map((q, i) => (q.type === "open" ? null : isRight(q, given[i])));
    const right = scored.filter((x) => x === true).length;
    const total = scored.filter((x) => x !== null).length;
    const card = h("article", { class: "cm-quiz", "aria-label": qz.title },
      h("header", { class: "cm-quiz__head" },
        h("div", {}, h("h3", { text: qz.title }), h("p", { class: "cm-muted cm-num", text: qz.summary })),
        h("div", { class: "cm-quiz__tools" },
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", title: "Markdown olarak indir", onclick: () => this.actions.exportMd(qz) }, "İndir"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", title: "Tekrar moduna kart olarak ekle", onclick: () => this.actions.toCards(qz) }, "Kartlara ekle"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--icon", "aria-label": "Quizi sil", title: "Quizi sil", onclick: () => this.actions.remove(qz.id) }, icon("trash")),
        ),
      ),
      h("ol", { class: "cm-quiz__list" }, ...qz.questions.map((q, i) => this.question(qz, q, i, given, checked))),
      h("footer", { class: "cm-quiz__foot" },
        checked
          ? h("p", { class: "cm-quiz__score", role: "status" }, h("strong", { class: "cm-num", text: `${right} / ${total}` }), total < qz.questions.length ? " · klasik soruları örnek cevapla kendin karşılaştır" : "")
          : h("span", { class: "cm-muted", text: `${given.filter((g) => g !== undefined && g !== "").length} / ${qz.questions.length} cevaplandı` }),
        h("div", { style: "display:flex;gap:8px" },
          checked
            ? h("button", { class: "cm-btn", onclick: () => (this.checked.delete(qz.id), this.given.set(qz.id, []), this.rerender()) }, "Yeniden dene")
            : h("button", { class: "cm-btn cm-btn--primary", onclick: () => (this.checked.add(qz.id), this.rerender()) }, "Kontrol et"),
        ),
      ),
    );
    return card;
  }

  private rerender(): void {
    const y = this.el.closest(".cm-stage")?.scrollTop;
    this.render(this.quizzes);
    const stage = this.el.closest(".cm-stage");
    if (stage && y !== undefined) stage.scrollTop = y;
  }

  private question(_qz: Quiz, q: QuizQuestion, i: number, given: Given[], checked: boolean): HTMLElement {
    const set = (v: Given) => {
      given[i] = v;
      if (q.type === "mc" || q.type === "tf") this.rerender();
    };
    const ok = checked ? (q.type === "open" ? null : isRight(q, given[i])) : null;
    const li = h("li", { class: `cm-quiz__q${ok === true ? " is-right" : ok === false ? " is-wrong" : ""}` },
      h("p", { class: "cm-quiz__text" },
        h("span", { text: q.q }),
        q.page ? h("button", { class: "cm-linkbtn cm-num", title: "Sayfaya git", onclick: () => this.actions.goTo(q.page! - 1) }, ` s. ${q.page}`) : null),
    );
    if (q.type === "mc") {
      li.append(h("div", { class: "cm-quiz__opts", role: "radiogroup", "aria-label": `Soru ${i + 1} şıkları` },
        ...q.options!.map((o, k) => {
          const chosen = given[i] === k;
          const cls = checked ? (k === q.answer ? " is-answer" : chosen ? " is-wrong" : "") : "";
          return h("button", { class: `cm-quiz__opt${chosen ? " is-on" : ""}${cls}`, role: "radio", "aria-checked": String(chosen), disabled: checked, onclick: () => set(k) },
            h("span", { class: "cm-quiz__letter", text: String.fromCharCode(65 + k) }), h("span", { text: o }));
        })));
    } else if (q.type === "tf") {
      li.append(h("div", { class: "cm-quiz__opts cm-quiz__opts--row", role: "radiogroup", "aria-label": `Soru ${i + 1}` },
        ...[true, false].map((v) => {
          const chosen = given[i] === v;
          const cls = checked ? (v === q.answer ? " is-answer" : chosen ? " is-wrong" : "") : "";
          return h("button", { class: `cm-quiz__opt${chosen ? " is-on" : ""}${cls}`, role: "radio", "aria-checked": String(chosen), disabled: checked, onclick: () => set(v) }, v ? "Doğru" : "Yanlış");
        })));
    } else {
      const field = q.type === "open"
        ? h("textarea", { class: "cm-input cm-quiz__input", rows: 4, "aria-label": `Soru ${i + 1} cevabı`, disabled: checked, spellcheck: "true", lang: "tr" })
        : h("input", { class: "cm-input cm-quiz__input", "aria-label": `Soru ${i + 1} cevabı`, disabled: checked, spellcheck: "false" });
      field.value = typeof given[i] === "string" ? (given[i] as string) : "";
      field.addEventListener("input", () => set(field.value));
      field.addEventListener("keydown", (e) => e.stopPropagation());
      li.append(field);
    }
    if (checked) {
      const answer = q.type === "mc" ? `${String.fromCharCode(65 + (q.answer as number))}) ${q.options![q.answer as number]}` : q.type === "tf" ? (q.answer ? "Doğru" : "Yanlış") : String(q.answer);
      li.append(h("div", { class: "cm-quiz__explain" },
        h("p", {}, h("strong", { text: ok === true ? "Doğru. " : ok === false ? "Yanlış. " : q.type === "open" ? "Örnek cevap: " : "Cevap: " }), ok === true ? "" : answer),
        q.explanation ? h("p", { class: "cm-muted", text: q.explanation }) : null));
    }
    return li;
  }
}

function isRight(q: QuizQuestion, g: Given): boolean {
  if (g === undefined || g === "") return false;
  if (q.type === "mc" || q.type === "tf") return g === q.answer;
  return checkText(String(g), String(q.answer));
}
