// El yazısı tanıma (cihazda, çevrimdışı): rakamlar 0–9, Türk alfabesinin 29 harfi (küçük ve büyük) ve birkaç işaret.
// Yöntem: $P nokta bulutu tanıyıcı (Vatavu, Anthony, Wobbrock 2012). Çizgi sırası ve yönü önemsizdir, çok
// çizgili harfler (i, ö, ç, ğ, ş, t, +) doğal olarak tanınır. Hazır şablonlar elle tanımlanmış; kullanıcı yanlış
// tanınan harfi düzelttikçe kendi el yazısı şablon olarak eklenir (yalnızca bu cihazda saklanır).
//
// Bu tanıyıcı ayrık (harfleri ayrı ayrı) yazı içindir: bitişik el yazısında harfler tek çizgi olduğundan
// ayrılamaz; o zaman güven eşiği aşılmaz ve çizim olduğu gibi kalır.

type Pt = [number, number];
type Strokes = Pt[][];

const N = 32;

// ---------- Şablon tanımı yardımcıları (y aşağı; büyük harf 0–1, küçük harf 0,45–1, alt uzantı 1,45'e kadar) ----------

/** Yay: merkez, yarıçaplar, başlangıç–bitiş açısı (derece; 0 sağ, 90 aşağı, artış saat yönünde). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps = 14): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}
const dot = (x: number, y: number): Pt[] => [[x, y], [x + 0.01, y + 0.02]];
const dots = (x: number, y: number): Pt[][] => [dot(x - 0.1, y), dot(x + 0.1, y)];
const cedilla = (x: number, y: number): Pt[] => [[x, y], [x + 0.05, y + 0.1], [x - 0.06, y + 0.18]];
const breve = (x: number, y: number): Pt[] => arc(x, y, 0.15, 0.1, 180, 0, 8);

/** Küçük harf "o" gövdesi ve türevleri. */
const bowlL = (cx = 0.28): Pt[] => arc(cx, 0.72, 0.27, 0.27, -90, -450);

const DEFS: [string, Strokes][] = [
  // Rakamlar
  ["0", [arc(0.3, 0.5, 0.3, 0.5, -90, 270, 20)]],
  ["1", [[[0.12, 0.22], [0.35, 0], [0.35, 1]]]],
  ["1", [[[0.35, 0], [0.35, 1]]]],
  ["1", [[[0.12, 0.22], [0.35, 0], [0.35, 1]], [[0.12, 1], [0.58, 1]]]],
  ["2", [[...arc(0.3, 0.28, 0.28, 0.26, -160, 20), [0, 1], [0.62, 1]]]],
  ["2", [[...arc(0.3, 0.3, 0.3, 0.3, -170, 40), [0.02, 1], [0.62, 0.98]]]],
  ["3", [[...arc(0.28, 0.25, 0.27, 0.25, -160, 90), ...arc(0.28, 0.75, 0.3, 0.25, -90, 160)]]],
  ["3", [[[0.02, 0.02], [0.55, 0.02], [0.25, 0.45], ...arc(0.28, 0.72, 0.3, 0.28, -100, 160)]]],
  ["4", [[[0.45, 1], [0.45, 0], [0, 0.7], [0.62, 0.7]]]],
  ["4", [[[0.1, 0], [0, 0.6], [0.62, 0.6]], [[0.45, 0.3], [0.45, 1]]]],
  ["5", [[[0.55, 0], [0.1, 0], [0.06, 0.45], ...arc(0.3, 0.7, 0.28, 0.3, -140, 160)]]],
  ["5", [[[0.08, 0], [0.06, 0.45], ...arc(0.3, 0.7, 0.28, 0.3, -140, 160)], [[0.08, 0], [0.58, 0]]]],
  ["6", [[[0.5, 0], [0.3, 0.15], [0.12, 0.4], ...arc(0.3, 0.72, 0.27, 0.27, 180, 540)]]],
  ["7", [[[0, 0], [0.6, 0], [0.2, 1]]]],
  ["7", [[[0, 0], [0.6, 0], [0.2, 1]], [[0.15, 0.5], [0.52, 0.5]]]],
  ["8", [[...arc(0.3, 0.25, 0.22, 0.25, -90, -270), ...arc(0.3, 0.75, 0.28, 0.25, -90, 270), ...arc(0.3, 0.25, 0.22, 0.25, 90, -90)]]],
  ["9", [[...arc(0.3, 0.28, 0.27, 0.28, 0, -360), [0.57, 0.28], [0.5, 1]]]],
  ["9", [[...arc(0.3, 0.28, 0.27, 0.28, 0, -360), [0.57, 0.28], [0.57, 1]]]],
  // Küçük harfler
  ["a", [[...arc(0.27, 0.72, 0.27, 0.27, -30, -390), [0.55, 0.45], [0.55, 1]]]],
  ["a", [[...arc(0.27, 0.72, 0.27, 0.27, -30, -390)], [[0.55, 0.45], [0.55, 1]]]],
  ["b", [[[0.05, 0], [0.05, 1]], arc(0.3, 0.72, 0.25, 0.28, -160, 160)]],
  ["b", [[[0.05, 0], [0.05, 1], ...arc(0.28, 0.77, 0.24, 0.22, 120, -180)]]],
  ["c", [arc(0.28, 0.72, 0.27, 0.27, -40, -320)]],
  ["ç", [arc(0.28, 0.72, 0.27, 0.27, -40, -320), cedilla(0.28, 1)]],
  ["d", [[...arc(0.27, 0.72, 0.27, 0.27, -30, -390)], [[0.55, 0], [0.55, 1]]]],
  ["e", [[[0.02, 0.72], [0.55, 0.72], ...arc(0.28, 0.72, 0.27, 0.27, 0, -320)]]],
  ["f", [[...arc(0.45, 0.15, 0.18, 0.15, -20, -180), [0.27, 1]], [[0.08, 0.45], [0.5, 0.45]]]],
  ["g", [[...arc(0.27, 0.72, 0.27, 0.27, -30, -390), [0.55, 0.45], [0.55, 1.25], ...arc(0.3, 1.25, 0.25, 0.2, 0, 160)]]],
  ["ğ", [[...arc(0.27, 0.72, 0.27, 0.27, -30, -390), [0.55, 0.45], [0.55, 1.25], ...arc(0.3, 1.25, 0.25, 0.2, 0, 160)], breve(0.28, 0.22)]],
  ["h", [[[0.05, 0], [0.05, 1]], [[0.05, 0.7], ...arc(0.3, 0.7, 0.25, 0.22, 180, 360), [0.55, 1]]]],
  ["ı", [[[0.1, 0.45], [0.1, 1]]]],
  ["i", [[[0.1, 0.45], [0.1, 1]], dot(0.1, 0.24)]],
  ["j", [[[0.3, 0.45], [0.3, 1.25], ...arc(0.15, 1.25, 0.15, 0.15, 0, 160)], dot(0.3, 0.24)]],
  ["k", [[[0.05, 0], [0.05, 1]], [[0.45, 0.45], [0.05, 0.75], [0.45, 1]]]],
  ["l", [[[0.1, 0], [0.1, 1]]]],
  ["m", [[[0.03, 0.45], [0.03, 1]], [[0.03, 0.62], ...arc(0.18, 0.62, 0.15, 0.17, 180, 360), [0.33, 1]], [[0.33, 0.62], ...arc(0.48, 0.62, 0.15, 0.17, 180, 360), [0.63, 1]]]],
  ["n", [[[0.05, 0.45], [0.05, 1]], [[0.05, 0.65], ...arc(0.3, 0.68, 0.25, 0.22, 180, 360), [0.55, 1]]]],
  ["o", [bowlL()]],
  ["ö", [bowlL(), ...dots(0.28, 0.25)]],
  ["p", [[[0.05, 0.45], [0.05, 1.45]], arc(0.3, 0.72, 0.25, 0.27, -160, 160)]],
  ["r", [[[0.05, 0.45], [0.05, 1]], [[0.05, 0.65], ...arc(0.25, 0.65, 0.2, 0.17, 180, 320)]]],
  ["s", [[...arc(0.25, 0.59, 0.22, 0.14, -10, -270), ...arc(0.25, 0.86, 0.22, 0.14, -90, 170)]]],
  ["ş", [[...arc(0.25, 0.59, 0.22, 0.14, -10, -270), ...arc(0.25, 0.86, 0.22, 0.14, -90, 170)], cedilla(0.25, 1)]],
  ["t", [[[0.25, 0.12], [0.25, 0.92], [0.35, 1], [0.45, 0.95]], [[0.05, 0.45], [0.5, 0.45]]]],
  ["u", [[[0.03, 0.45], [0.03, 0.8], ...arc(0.28, 0.8, 0.25, 0.2, 180, 0), [0.53, 0.45], [0.53, 1]]]],
  ["ü", [[[0.03, 0.45], [0.03, 0.8], ...arc(0.28, 0.8, 0.25, 0.2, 180, 0), [0.53, 0.45], [0.53, 1]], ...dots(0.28, 0.25)]],
  ["v", [[[0, 0.45], [0.27, 1], [0.55, 0.45]]]],
  ["y", [[[0, 0.45], [0.27, 1]], [[0.55, 0.45], [0.15, 1.45]]]],
  ["z", [[[0.03, 0.45], [0.53, 0.45], [0.03, 1], [0.55, 1]]]],
  // Büyük harfler (biçimi küçüğünden ayrılanlar; C, O, S, U, V, Z gibileri boyuttan anlaşılır)
  ["A", [[[0, 1], [0.3, 0], [0.6, 1]], [[0.12, 0.62], [0.48, 0.62]]]],
  ["B", [[[0.05, 0], [0.05, 1]], [[0.05, 0], ...arc(0.27, 0.25, 0.22, 0.25, -90, 90), [0.05, 0.5], ...arc(0.3, 0.75, 0.25, 0.25, -90, 90), [0.05, 1]]]],
  ["D", [[[0.05, 0], [0.05, 1]], [[0.05, 0], ...arc(0.15, 0.5, 0.45, 0.5, -90, 90), [0.05, 1]]]],
  ["E", [[[0.55, 0], [0.05, 0], [0.05, 1], [0.55, 1]], [[0.05, 0.5], [0.45, 0.5]]]],
  ["F", [[[0.55, 0], [0.05, 0], [0.05, 1]], [[0.05, 0.5], [0.45, 0.5]]]],
  ["G", [[...arc(0.4, 0.5, 0.4, 0.5, -40, -345), [0.79, 0.55], [0.45, 0.55]]]],
  ["Ğ", [[...arc(0.4, 0.5, 0.4, 0.5, -40, -345), [0.79, 0.55], [0.45, 0.55]], breve(0.4, -0.2)]],
  ["H", [[[0.05, 0], [0.05, 1]], [[0.6, 0], [0.6, 1]], [[0.05, 0.5], [0.6, 0.5]]]],
  ["İ", [[[0.3, 0], [0.3, 1]], dot(0.3, -0.22)]],
  ["J", [[[0.5, 0], [0.5, 0.75], ...arc(0.27, 0.75, 0.23, 0.25, 0, 160)]]],
  ["K", [[[0.05, 0], [0.05, 1]], [[0.55, 0], [0.05, 0.55], [0.6, 1]]]],
  ["L", [[[0.05, 0], [0.05, 1], [0.55, 1]]]],
  ["M", [[[0, 1], [0.05, 0], [0.35, 0.6], [0.65, 0], [0.7, 1]]]],
  ["N", [[[0.05, 1], [0.05, 0], [0.6, 1], [0.6, 0]]]],
  ["R", [[[0.05, 1], [0.05, 0]], [[0.05, 0], ...arc(0.27, 0.25, 0.22, 0.25, -90, 90), [0.05, 0.5]], [[0.25, 0.5], [0.6, 1]]]],
  ["T", [[[0, 0], [0.6, 0]], [[0.3, 0], [0.3, 1]]]],
  ["Y", [[[0, 0], [0.3, 0.5], [0.6, 0]], [[0.3, 0.5], [0.3, 1]]]],
  // İşaretler
  ["+", [[[0, 0.5], [0.6, 0.5]], [[0.3, 0.2], [0.3, 0.8]]]],
  ["-", [[[0, 0.5], [0.6, 0.5]]]],
  ["=", [[[0, 0.38], [0.6, 0.38]], [[0, 0.62], [0.6, 0.62]]]],
  ["×", [[[0, 0.2], [0.5, 0.7]], [[0.5, 0.2], [0, 0.7]]]],
  ["/", [[[0.5, 0], [0, 1]]]],
  ["(", [arc(0.45, 0.5, 0.4, 0.5, -120, -240)]],
  [")", [arc(0, 0.5, 0.4, 0.5, -60, 60)]],
  ["?", [[...arc(0.3, 0.25, 0.25, 0.25, -170, 60), [0.3, 0.5], [0.3, 0.7]], dot(0.3, 0.95)]],
];

// ---------- $P ----------

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Çizgileri toplam yol boyunca `n` eşit aralıklı noktaya indir (çizgiler arası boşluk köprülenmez). */
export function resample(strokes: Strokes, n = N): Pt[] {
  const parts = strokes.filter((s) => s.length);
  if (!parts.length) return [];
  let total = 0;
  for (const s of parts) for (let i = 1; i < s.length; i++) total += dist(s[i - 1], s[i]);
  if (total === 0) return Array.from({ length: n }, () => [...parts[0][0]] as Pt);
  const step = total / (n - 1);
  const out: Pt[] = [[...parts[0][0]] as Pt];
  let acc = 0;
  for (const s of parts) {
    for (let i = 1; i < s.length; i++) {
      let prev: Pt = s[i - 1];
      const cur = s[i];
      let d = dist(prev, cur);
      while (acc + d >= step && d > 0 && out.length < n) {
        const t = (step - acc) / d;
        const q: Pt = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
        out.push(q);
        prev = q;
        d = dist(prev, cur);
        acc = 0;
      }
      acc += d;
    }
  }
  const last = parts[parts.length - 1];
  while (out.length < n) out.push([...last[last.length - 1]] as Pt);
  return out.slice(0, n);
}

/** Ölçek (en uzun kenar 1) ve konum (ağırlık merkezi 0) bağımsızlığı; en-boy oranı korunur. */
function normalize(pts: Pt[]): Pt[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const s = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const cx = xs.reduce((a, b) => a + b, 0) / pts.length;
  const cy = ys.reduce((a, b) => a + b, 0) / pts.length;
  return pts.map(([x, y]) => [(x - cx) / s, (y - cy) / s]);
}

export function cloud(strokes: Strokes): Pt[] {
  return normalize(resample(strokes));
}

function cloudDistance(a: Pt[], b: Pt[], start: number, best: number): number {
  const n = a.length;
  const matched = new Uint8Array(n);
  let sum = 0;
  let i = start;
  do {
    let mi = -1;
    let md = Infinity;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = dist(a[i], b[j]);
      if (d < md) {
        md = d;
        mi = j;
      }
    }
    matched[mi] = 1;
    sum += (1 - ((i - start + n) % n) / n) * md;
    if (sum >= best) return sum;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

export function greedyMatch(a: Pt[], b: Pt[], best = Infinity): number {
  const step = Math.floor(Math.sqrt(a.length));
  let min = best;
  for (let i = 0; i < a.length; i += step) {
    min = Math.min(min, cloudDistance(a, b, i, min), cloudDistance(b, a, i, min));
  }
  return min;
}

// ---------- Şablonlar: hazır + eğik / dar / geniş türevleri + kullanıcının öğrettikleri ----------

interface Template { ch: string; pts: Pt[]; user?: boolean }
const USER_KEY = "cm-hw-templates";
const MAX_USER = 400;
let builtIn: Template[] | null = null;
let userTpl: Template[] | null = null;

function variants(strokes: Strokes): Strokes[] {
  const tf = (sx: number, shear: number) => strokes.map((s) => s.map(([x, y]) => [x * sx - (y - 0.7) * shear, y] as Pt));
  return [strokes, tf(1, 0.22), tf(1, -0.12), tf(0.75, 0), tf(1.3, 0), tf(0.85, 0.3)];
}

function templates(): Template[] {
  builtIn ??= DEFS.flatMap(([ch, strokes]) => variants(strokes).map((v) => ({ ch, pts: cloud(v) })));
  if (!userTpl) {
    try {
      const raw = JSON.parse(localStorage.getItem(USER_KEY) ?? "[]") as { ch: string; pts: Pt[] }[];
      userTpl = raw.filter((t) => typeof t.ch === "string" && Array.isArray(t.pts) && t.pts.length === N).map((t) => ({ ...t, user: true }));
    } catch {
      userTpl = [];
    }
  }
  return [...userTpl, ...builtIn];
}

/** Kullanıcının düzelttiği harfi kendi şablonu olarak ekle (bu cihazda saklanır). */
export function learn(ch: string, strokes: Strokes): void {
  if (!ch.trim() || [...ch].length !== 1 || !strokes.some((s) => s.length > 1)) return;
  templates();
  userTpl!.unshift({ ch, pts: cloud(strokes), user: true });
  userTpl!.splice(MAX_USER);
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(userTpl!.map(({ ch: c, pts }) => ({ ch: c, pts: pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) }))));
  } catch {
    /* depolama kapalı: öğrenilen yalnızca bu oturumda kalır */
  }
}

export function forgetLearned(): void {
  userTpl = [];
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* yok say */
  }
}

/** Tek harf: en iyi aday, uzaklığı ve farklı bir harfin en iyi uzaklığı. Kullanıcı şablonları hafif öncelikli. */
export function classify(strokes: Strokes): { ch: string; d: number; d2: number } {
  const c = cloud(strokes);
  const best = new Map<string, number>();
  let bound = Infinity;
  for (const t of templates()) {
    const d = greedyMatch(c, t.pts, Math.min(bound * 1.6, (best.get(t.ch) ?? Infinity))) * (t.user ? 0.9 : 1);
    if (d < (best.get(t.ch) ?? Infinity)) best.set(t.ch, d);
    bound = Math.min(bound, d);
  }
  const sorted = [...best.entries()].sort((a, b) => a[1] - b[1]);
  return { ch: sorted[0][0], d: sorted[0][1], d2: sorted[1]?.[1] ?? Infinity };
}

// ---------- Satır tanıma: harflere ve kelimelere ayır, sınıflandır, büyük/küçük harf ve rakam bağlamı ----------

export interface HwGlyph { ch: string; strokes: Strokes }
export interface HwLine {
  text: string;
  /** Kelime boşlukları hariç harf sırasıyla; düzeltmeden öğrenmek için. */
  glyphs: HwGlyph[];
  /** Satırın kutusu (0–1) ve büyük harf yüksekliği (piksel). */
  box: [number, number, number, number];
  capPx: number;
}

/** Tanıma güveni: bu uzaklığın üstündeki harf tanınmamış sayılır ($P uzaklığı, normalize birimde). */
const MAX_D = 1.7;
/** Satırda tek harf varsa daha sıkı: tek başına çizgi ya da karalama harf sanılmasın. */
const MAX_D_SINGLE = 1.15;

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

interface Box { x0: number; y0: number; x1: number; y1: number }
const boxOf = (strokes: Strokes): Box => {
  const pts = strokes.flat();
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
};

/** Küçük ve büyük biçimi aynı harfler: hangisi olduğu satırdaki boyuttan anlaşılır. */
const SAME_SHAPE: Record<string, string> = { c: "C", ç: "Ç", o: "O", ö: "Ö", s: "S", ş: "Ş", u: "U", ü: "Ü", v: "V", z: "Z", p: "P", y: "Y" };
const UPPER_ONLY = new Set(["A", "B", "D", "E", "F", "G", "Ğ", "H", "İ", "J", "K", "L", "M", "N", "R", "T", "Y"]);
const LOWER_ONLY = new Set(["a", "b", "d", "e", "f", "g", "ğ", "h", "i", "j", "m", "n", "r", "t"]);
const LONE_AMBIGUOUS = new Set(["1", "l", "ı", "I", "0", "o", "c", "v", "-", "/", "(", ")", "+", "×", "=", "?"]);
const DIGITISH: Record<string, string> = { o: "0", O: "0", l: "1", I: "1", ı: "1", s: "5", S: "5", z: "2", Z: "2", g: "9", q: "9", b: "6", B: "8" };
const LETTERISH: Record<string, string> = { "0": "o", "5": "s", "2": "z", "9": "g", "6": "b" };

/**
 * Bir satırlık el yazısı çizgisini (0–1, `w`×`h` piksel sayfa) metne çevir. Her harf güvenle tanınmazsa `null`:
 * çizim olabilir, dokunulmaz.
 */
export function recognizeLine(input: Strokes, w: number, h: number): HwLine | null {
  const strokes = input.filter((s) => s.length).map((s) => s.map(([x, y]) => [x * w, y * h] as Pt));
  if (!strokes.length) return null;
  const sb = strokes.map((s) => boxOf([s]));
  const heights = sb.map((b) => b.y1 - b.y0).filter((v) => v > 6);
  const unit = Math.max(10, median(heights.length ? heights : [12]));
  const lineBox = boxOf(strokes);
  // Satır gibi değilse (çok yüksek ya da tek dev çizim) tanıma: şekil ya da çizim olabilir.
  if (lineBox.y1 - lineBox.y0 > unit * 3.2 || unit > 160) return null;

  // Harflere ayır: x aralığı örtüşen ya da küçük (nokta, kanca) çizgiler aynı harf.
  const order = strokes.map((_, i) => i).sort((a, b) => sb[a].x0 - sb[b].x0);
  const groups: { idx: number[]; b: Box }[] = [];
  for (const i of order) {
    const b = sb[i];
    const small = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < unit * 0.45;
    let target: (typeof groups)[number] | null = null;
    for (const g of groups.slice(-2).reverse()) {
      const ov = Math.min(g.b.x1, b.x1) - Math.max(g.b.x0, b.x0);
      const narrow = Math.min(g.b.x1 - g.b.x0, b.x1 - b.x0) || 1;
      // Dikey sap (m, n, k, h, b'nin sapı) yanındaki kemere / kollara değiyorsa aynı harf.
      const stem = Math.min(g.b.x1 - g.b.x0, b.x1 - b.x0) < unit * 0.2;
      // Art arda yazılıp birbirine değen çizgiler (m'nin iki kemeri) aynı harf.
      const consecutive = g.idx.includes(i - 1) || g.idx.includes(i + 1);
      const touching = consecutive && ov > -unit * 0.08;
      // Sap ve hemen ardından yazılan kollar (k, h, b): kol saptan biraz ayrık başlayabilir.
      const stemH = Math.max(g.b.x1 - g.b.x0 < b.x1 - b.x0 ? g.b.y1 - g.b.y0 : b.y1 - b.y0, unit);
      const stemArm = stem && consecutive && ov > -stemH * 0.25 && Math.abs(g.b.y1 - b.y1) < stemH * 0.4;
      if (ov > narrow * 0.3 || (small && ov > -unit * 0.15) || (stem && ov > -unit * 0.1) || touching || stemArm) {
        target = g;
        break;
      }
    }
    if (target) {
      target.idx.push(i);
      target.b = { x0: Math.min(target.b.x0, b.x0), y0: Math.min(target.b.y0, b.y0), x1: Math.max(target.b.x1, b.x1), y1: Math.max(target.b.y1, b.y1) };
    } else groups.push({ idx: [i], b: { ...b } });
  }
  if (groups.length > 60) return null;

  const gh = groups.map((g) => g.b.y1 - g.b.y0);
  const capH = Math.max(...gh);
  const baseline = median(groups.filter((_, k) => gh[k] > capH * 0.3).map((g) => g.b.y1));
  const results: { ch: string; g: (typeof groups)[number]; tiny: boolean }[] = [];
  for (const g of groups) {
    const gs = g.idx.map((i) => strokes[i]);
    const hgt = g.b.y1 - g.b.y0;
    const wid = g.b.x1 - g.b.x0;
    // Nokta / virgül: küçük, taban çizgisinde.
    if (Math.max(hgt, wid) < capH * 0.22 && g.b.y0 > baseline - capH * 0.35) {
      results.push({ ch: g.b.y1 > baseline + capH * 0.12 ? "," : ".", g, tiny: true });
      continue;
    }
    const r = classify(gs);
    if (r.d > (groups.length === 1 ? MAX_D_SINGLE : MAX_D)) return null;
    // Tek başına çizgi, daire, tik ya da işaret yazı sayılmaz (altı çizme, madde imi, onay işareti olabilir).
    if (groups.length === 1 && LONE_AMBIGUOUS.has(r.ch)) return null;
    results.push({ ch: r.ch, g, tiny: false });
  }

  // Kelimeler: harfler arası boşluk birimin yarısından büyükse.
  const words: (typeof results)[] = [];
  results.forEach((r, k) => {
    const gap = k ? r.g.b.x0 - results[k - 1].g.b.x1 : 0;
    if (!k || gap > unit * 0.9) words.push([r]);
    else words[words.length - 1].push(r);
  });

  // Büyük harf satırı mı? Yalnız büyük harf biçimi var, küçük harfe özgü biçim yoksa evet.
  const all = results.filter((r) => !r.tiny).map((r) => r.ch);
  const capsLine = all.some((c) => UPPER_ONLY.has(c)) && !all.some((c) => LOWER_ONLY.has(c));
  const hasShort = gh.some((v) => v < capH * 0.72);

  const out: string[] = [];
  const glyphs: HwGlyph[] = [];
  for (const word of words) {
    const letters = word.filter((r) => !r.tiny);
    const digitCount = letters.filter((r) => /[\d+\-=×/()]/.test(r.ch)).length;
    const numeric = letters.length > 0 && digitCount * 2 >= letters.length;
    let s = "";
    for (const r of word) {
      let ch = r.ch;
      const hgt = r.g.b.y1 - r.g.b.y0;
      const desc = r.g.b.y1 > baseline + capH * 0.22;
      if (!r.tiny) {
        if (numeric && DIGITISH[ch]) ch = DIGITISH[ch];
        else if (!numeric && LETTERISH[ch]) ch = LETTERISH[ch];
        else if (!numeric && (ch === "1" || ch === "l" || ch === "I" || ch === "ı")) ch = capsLine ? "I" : hgt >= capH * 0.82 && hasShort ? "l" : "ı";
        if (ch === "Y" && desc) ch = "y";
        // Aynı biçimli harfler: büyük harf satırı ya da kısa harflerin yanında boyca yüksek → büyük.
        if (SAME_SHAPE[ch]) {
          if (ch === "p" || ch === "y") ch = desc ? ch : SAME_SHAPE[ch];
          else if (capsLine || (hasShort && hgt >= capH * 0.85)) ch = SAME_SHAPE[ch];
        }
      }
      s += ch;
      glyphs.push({ ch, strokes: r.g.idx.map((i) => input[i]) });
    }
    out.push(s);
  }
  const text = out.join(" ");
  if (!text.trim()) return null;
  return {
    text,
    glyphs,
    box: [lineBox.x0 / w, lineBox.y0 / h, (lineBox.x1 - lineBox.x0) / w, (lineBox.y1 - lineBox.y0) / h],
    capPx: capH,
  };
}
