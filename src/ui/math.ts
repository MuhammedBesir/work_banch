import type katexType from "katex";

// AI cevaplarındaki LaTeX matematik ($…$, $$…$$, \(…\), \[…\]) KaTeX ile gerçek gösterime çevrilir.
// KaTeX ayrı bir parça: ilk matematikli cevapta yüklenir.

let katex: typeof katexType | null = null;
let loading: Promise<void> | null = null;

export function ensureKatex(): Promise<void> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => {
    katex = k.default;
  });
  return loading;
}

export const mathReady = () => !!katex;

// Sıra önemli: önce $$…$$ ve \[…\], sonra satır içi. "$5" gibi para tutarı matematik sayılmaz
// (açılış $'dan sonra ve kapanıştan önce boşluk olamaz).
const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/g;

export const hasMath = (text: string) => MATH.test(text) && !(MATH.lastIndex = 0);

/**
 * Metindeki matematiği yer tutucuyla değiştirir (cümle bölme ve kaynak etiketleri matematiği bölmesin).
 * Dönen `restore` bir DOM ağacındaki yer tutucuları matematik öğeleriyle değiştirir.
 */
export function protectMath(text: string): { text: string; restore(root: HTMLElement): void } {
  const parts: { tex: string; display: boolean }[] = [];
  const out = text.replace(MATH, (_, d1, d2, i1, i2) => {
    parts.push({ tex: (d1 ?? d2 ?? i1 ?? i2).trim(), display: d1 !== undefined || d2 !== undefined });
    return `⁣${parts.length - 1}⁣`;
  });
  return {
    text: out,
    restore(root) {
      if (!parts.length) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) if ((walker.currentNode as Text).data.includes("⁣")) nodes.push(walker.currentNode as Text);
      for (const node of nodes) {
        const frag = document.createDocumentFragment();
        node.data.split(/⁣(\d+)⁣/).forEach((piece, i) => {
          if (i % 2 === 0) {
            if (piece) frag.append(piece);
          } else {
            const p = parts[Number(piece)];
            frag.append(mathNode(p.tex, p.display));
          }
        });
        node.replaceWith(frag);
      }
    },
  };
}

export function mathNode(tex: string, display: boolean): HTMLElement {
  const el = document.createElement(display ? "div" : "span");
  el.className = display ? "cm-math cm-math--block" : "cm-math";
  if (!katex) {
    // KaTeX henüz yüklenmedi: kaynak yazı soluk gösterilir, yüklenince yeniden çizilir.
    el.textContent = tex;
    el.classList.add("is-raw");
    return el;
  }
  try {
    el.innerHTML = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "htmlAndMathml", strict: "ignore" });
  } catch {
    el.textContent = tex;
  }
  return el;
}

/** Düz metne (kopyala, not olarak ekle): LaTeX okunur karakterlere yaklaşık çevrilir. */
export function mathToPlain(text: string): string {
  return text.replace(MATH, (_, d1, d2, i1, i2) => texToPlain((d1 ?? d2 ?? i1 ?? i2).trim()));
}

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", tau: "τ", phi: "φ", omega: "ω",
  Delta: "Δ", Sigma: "Σ", Omega: "Ω", cdot: "·", times: "×", div: "÷", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈",
  infty: "∞", sum: "Σ", prod: "Π", int: "∫", sqrt: "√", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", emptyset: "∅",
  forall: "∀", exists: "∃", to: "→", rightarrow: "→", Rightarrow: "⇒", leftrightarrow: "↔", land: "∧", lor: "∨", neg: "¬", max: "max", min: "min",
};

function texToPlain(tex: string): string {
  return tex
    .replace(/\\(?:bar|overline)\{([^}]*)\}/g, "$1̄")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^}]*)\}/g, "√($1)")
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^}]*)\}/g, "$1")
    .replace(/\\([A-Za-z]+)/g, (m, name) => SYMBOLS[name] ?? m)
    .replace(/\\([{}$%&_#])/g, "$1")
    .replace(/_\{([^}]*)\}/g, "_$1")
    .replace(/\^\{([^}]*)\}/g, "^$1")
    .replace(/[{}]/g, "")
    .replace(/\\,|\;|\\!|\\ /g, " ")
    .normalize("NFC");
}

/** Bir ağaçtaki bütün metin düğümlerinde matematiği çiz (quiz soruları, şıklar, açıklamalar). */
export function renderMathIn(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest("input, textarea, .cm-math") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) if (hasMath((walker.currentNode as Text).data)) nodes.push(walker.currentNode as Text);
  if (!nodes.length) return;
  if (!mathReady()) {
    void ensureKatex().then(() => root.isConnected && renderMathIn(root));
    return;
  }
  for (const node of nodes) {
    const span = document.createElement("span");
    const m = protectMath(node.data);
    span.textContent = m.text;
    m.restore(span);
    node.replaceWith(...span.childNodes);
  }
}
