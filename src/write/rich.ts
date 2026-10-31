// Biçimli not: metin kutusu ve yapışkan notlar sade bir Markdown alt kümesiyle saklanır.
// `# başlık`, `- madde`, `1. sıralı`, `[ ] yapılacak` / `[x] yapıldı`, `| tablo | satırı |`,
// satır içinde **kalın**, *italik*, __altı çizili__, ~~üstü çizili~~.
// Düzenlerken düz metin görünür; okurken biçimli.

const CHECK = /^\[( |x|X)\] ?/;
const TABLE = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Satır içi biçim → DOM. */
function inline(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\s][^*]*)\*)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) frag.append(text.slice(at, m.index));
    const [tag, inner] = m[2] !== undefined ? ["strong", m[2]] : m[3] !== undefined ? ["u", m[3]] : m[4] !== undefined ? ["s", m[4]] : ["em", m[5]];
    const el = document.createElement(tag);
    el.append(inline(inner));
    frag.append(el);
    at = m.index! + m[0].length;
  }
  if (at < text.length) frag.append(text.slice(at));
  return frag;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/**
 * Biçimli metni çiz. `onToggle(satır)`: yapılacak kutusuna tıklanınca (salt okunur görünümde de çalışır).
 */
export function renderRich(text: string, onToggle?: (line: number) => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = text.split("\n");
  let list: HTMLElement | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TABLE.test(line)) {
      list = null;
      const table = document.createElement("table");
      table.className = "cm-rich__table";
      let first = true;
      while (i < lines.length && (TABLE.test(lines[i]) || TABLE_SEP.test(lines[i]))) {
        if (!TABLE_SEP.test(lines[i])) {
          const tr = table.insertRow();
          for (const c of cells(lines[i])) {
            const td = document.createElement(first ? "th" : "td");
            td.append(inline(c));
            tr.append(td);
          }
          first = false;
        }
        i++;
      }
      i--;
      frag.append(table);
      continue;
    }
    const bullet = /^\s*[-•*] (.*)$/.exec(line);
    const ordered = /^\s*(\d+)[.)] (.*)$/.exec(line);
    const check = CHECK.exec(line);
    if (bullet || ordered) {
      const tag = bullet ? "UL" : "OL";
      if (!list || list.tagName !== tag) {
        list = document.createElement(tag);
        list.className = "cm-rich__list";
        if (ordered) (list as HTMLOListElement).start = Number(ordered[1]);
        frag.append(list);
      }
      const li = document.createElement("li");
      li.append(inline(bullet ? bullet[1] : ordered![2]));
      list.append(li);
      continue;
    }
    list = null;
    if (check) {
      const row = document.createElement("div");
      row.className = "cm-rich__check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = check[1].toLowerCase() === "x";
      box.setAttribute("aria-label", richPlain(line.slice(check[0].length)) || "Yapılacak");
      const lineNo = i;
      box.addEventListener("pointerdown", (e) => e.stopPropagation());
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggle?.(lineNo);
      });
      if (!onToggle) box.disabled = true;
      const label = document.createElement("span");
      label.append(inline(line.slice(check[0].length)));
      if (box.checked) label.className = "is-done";
      row.append(box, label);
      frag.append(row);
      continue;
    }
    const head = /^(#{1,3}) (.*)$/.exec(line);
    const div = document.createElement("div");
    if (head) {
      div.className = `cm-rich__h${head[1].length}`;
      div.append(inline(head[2]));
    } else if (line.trim()) div.append(inline(line));
    else div.append(document.createElement("br"));
    frag.append(div);
  }
  return frag;
}

/** Yapılacak kutusunu çevir. */
export function toggleCheck(text: string, line: number): string {
  const lines = text.split("\n");
  const m = CHECK.exec(lines[line] ?? "");
  if (!m) return text;
  lines[line] = `[${m[1] === " " ? "x" : " "}] ${lines[line].slice(m[0].length)}`;
  return lines.join("\n");
}

/** Dışa aktarma ve arama için düz metin (işaretler atılır, yapılacaklar ☐ / ☑ olur). */
export function richPlain(text: string): string {
  return text
    .split("\n")
    .filter((l) => !TABLE_SEP.test(l) || !l.includes("-"))
    .map((l) => {
      if (TABLE.test(l)) return cells(l).join("  |  ");
      return l.replace(/^#{1,3} /, "").replace(CHECK, (_, x) => (x === " " ? "☐ " : "☑ "));
    })
    .join("\n")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~/g, (_, a, b, c) => a ?? b ?? c)
    .replace(/\*([^*\s][^*]*)\*/g, "$1")
    .trim();
}

/** Biçim çubuğu: seçili metni sarar ya da satır başına işaret ekler. */
export function applyFormat(el: HTMLElement, kind: "bold" | "italic" | "underline" | "strike" | "bullet" | "number" | "check" | "heading" | "table"): void {
  const sel = getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) {
    el.focus();
  }
  const wrap: Record<string, string> = { bold: "**", italic: "*", underline: "__", strike: "~~" };
  if (wrap[kind]) {
    const mark = wrap[kind];
    const text = sel?.toString() ?? "";
    insertText(`${mark}${text}${mark}`);
    // Seçim yoksa imleç işaretlerin arasına: yazılan metin biçimli olur.
    if (!text) moveCaret(-mark.length);
    return;
  }
  if (kind === "table") {
    insertText("\n| Başlık | Başlık |\n| --- | --- |\n|  |  |\n");
    return;
  }
  const prefix = ({ bullet: "- ", number: "1. ", check: "[ ] ", heading: "# " } as Record<string, string>)[kind] ?? "";
  // Satır başına ekle: imleci satır başına götürmek yerine yeni satır açılır.
  const before = textBeforeCaret(el);
  insertText(before === "" || before.endsWith("\n") ? prefix : `\n${prefix}`);
}

function insertText(t: string): void {
  // execCommand hâlâ contenteditable'da geri al geçmişini koruyan tek yol.
  if (!document.execCommand("insertText", false, t)) {
    const sel = getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(document.createTextNode(t));
    r.collapse(false);
  }
}

function moveCaret(by: number): void {
  const sel = getSelection();
  if (!sel?.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (r.startContainer.nodeType !== Node.TEXT_NODE) return;
  const at = Math.max(0, r.startOffset + by);
  r.setStart(r.startContainer, at);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function textBeforeCaret(el: HTMLElement): string {
  const sel = getSelection();
  if (!sel?.rangeCount) return el.innerText;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return r.toString();
}
