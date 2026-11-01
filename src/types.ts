export type Color = 1 | 2 | 3 | 4;
export const COLORS: readonly Color[] = [1, 2, 3, 4];

/** Sayfaya göre normalleştirilmiş dikdörtgen: [x, y, genişlik, yükseklik], hepsi 0–1 arası. */
export type Rect = [number, number, number, number];

export interface Highlight {
  id: string;
  fileHash: string;
  /** 0 tabanlı sayfa sırası. */
  page: number;
  color: Color;
  rects: Rect[];
  text: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  /** Birden fazla sayfaya yayılan seçim: parçalar aynı grup kimliğini taşır ve tek vurgu gibi davranır. */
  group?: string;
  /** Ses kaydı sırasında eklendiyse: kayıt ve kaydın başından itibaren milisaniye. */
  rec?: { id: string; t: number };
}

export type PenColor = "black" | "blue" | "red";
export const PEN_COLORS: readonly PenColor[] = ["black", "blue", "red"];
/** Yapışkan not rengi. */
export type StickyTint = "yellow" | "pink" | "blue" | "green" | "purple" | "gray";
export const STICKY_TINTS: readonly StickyTint[] = ["yellow", "pink", "blue", "green", "purple", "gray"];

/** Kalem rengi: üç hazır renk ya da özel renk (`#rrggbb`). */
export type InkColor = PenColor | `#${string}`;
export type ShapeKind = "rect" | "ellipse" | "arrow";
/** Kalem türü: tükenmez (varsayılan), kurşun kalem, fosforlu kalem, dolma kalem (açılı uç). */
export type PenKind = "pen" | "pencil" | "marker" | "fountain";
export const PEN_KINDS: readonly PenKind[] = ["pen", "pencil", "marker", "fountain"];

/** Yaz modundaki işaret. Koordinatlar sayfaya göre 0–1 arası. */
export type Mark =
  | (MarkBase & {
      kind: "ink"; color: InkColor; width: number; points: [number, number][]; pressures?: number[];
      pen?: PenKind;
      /** Şekil tanımadan gelen köşeli çizgi (düz çizgi, üçgen, çokgen): yumuşatılmaz. */
      straight?: boolean;
    })
  | (MarkBase & { kind: "shape"; color: InkColor; width: number; shape: ShapeKind; from: [number, number]; to: [number, number] })
  | (MarkBase & { kind: "text"; color: InkColor; box: Rect; text: string; size?: number })
  | (MarkBase & { kind: "sticky"; box: Rect; text: string; collapsed?: boolean; ai?: boolean; pageNote?: boolean; tint?: StickyTint })
  | (MarkBase & { kind: "image"; box: Rect; src: string; alt: string });

export interface MarkBase {
  id: string;
  fileHash: string;
  page: number;
  createdAt: number;
  updatedAt: number;
  /** Ses kaydı sırasında eklendiyse: kayıt ve kaydın başından itibaren milisaniye. */
  rec?: { id: string; t: number };
}

/** Tekrar modu kartı. Vurgu kartları kendiliğinden oluşur; AI kartları onaylanmadan desteye girmez. */
export interface Card {
  id: string;
  fileHash: string;
  page: number;
  source: "highlight" | "ai";
  highlightId?: string;
  color?: Color;
  front: string;
  back: string;
  note?: string;
  status: "active" | "suggested";
  due: number;
  /** Gün. */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  createdAt: number;
  updatedAt: number;
}

export type ScrollMode = "continuous" | "paged";

export interface FileRecord {
  hash: string;
  name: string;
  size: number;
  pageCount: number;
  lastPage: number;
  lastOpened: number;
  bookmarks: number[];
  scrollMode?: ScrollMode;
  scannedDismissed?: boolean;
  /** Aynı içeriğin daha önce açıldığı diğer dosya adları. */
  aliases?: string[];
  /** File System Access API tutamacı (yalnızca Chromium). */
  handle?: FileSystemFileHandle;
  /** Son açılanlarda düzen: klasör, etiketler, başa sabitleme, kapak rengi. */
  folder?: string;
  tags?: string[];
  pinned?: boolean;
  cover?: string;
  /** Not kilidi: PIN'in PBKDF2 özeti. Veri şifrelenmez; paylaşılan bilgisayarda açılmayı engeller. */
  lock?: { salt: string; hash: string };
  /** Uygulamada oluşturulan boş not defteri. */
  notebook?: { template: "blank" | "lined" | "grid" | "dots" };
}

/** Ders sırasında alınan ses kaydı; işaretler kaydın içindeki ana bağlanır. */
export interface Recording {
  id: string;
  fileHash: string;
  createdAt: number;
  /** Milisaniye. */
  duration: number;
  mime: string;
  blob: Blob;
  title: string;
  /** Yazıya dökülmüş metin: parçalar kaydın başından itibaren milisaniyeyle. */
  transcript?: { t: number; text: string }[];
}

export type ThemeSetting = "light" | "dark" | "system";
export type PdfDark = "soften" | "original";
export type UiSize = "small" | "normal" | "large";

/** AI'nın nerede çalıştığı: bulut sağlayıcısı (kendi anahtarınla), bilgisayardaki yerel sunucu ya da tarayıcıda (cihazda). */
export type AiProvider = "anthropic" | "openai" | "gemini" | "local" | "device";
export type AiMode = "off" | AiProvider;

export interface AiSettings {
  mode: AiMode;
  /** Yalnızca bu tarayıcıda saklanır; yedeğe girmez. */
  keys: { anthropic: string; openai: string; gemini: string };
  models: Record<AiProvider, string>;
  /** OpenAI uyumlu yerel sunucu (Ollama, LM Studio). */
  localUrl: string;
}

export const AI_PROVIDERS: Record<AiProvider, { label: string; short: string; cloud: boolean; models: [string, string][] }> = {
  anthropic: {
    label: "Anthropic (Claude)", short: "Claude", cloud: true,
    models: [
      ["claude-opus-5-5", "Claude Opus 5.5 (en iyi)"],
      ["claude-sonnet-5-5", "Claude Sonnet 5.5 (hızlı)"],
      ["claude-haiku-5-5", "Claude Haiku 5.5 (en ucuz)"],
    ],
  },
  openai: { label: "OpenAI", short: "OpenAI", cloud: true, models: [["gpt-5", "GPT-5"], ["gpt-5-mini", "GPT-5 mini"]] },
  // Takma adlar her zaman Google'ın güncel modeline gider; kesin sürüm "Modelleri yükle" ile seçilir.
  gemini: {
    label: "Google Gemini", short: "Gemini", cloud: true,
    models: [["gemini-flash-latest", "Gemini Flash (güncel, hızlı)"], ["gemini-pro-latest", "Gemini Pro (güncel, en iyi)"], ["gemini-flash-lite-latest", "Gemini Flash-Lite (en ucuz)"]],
  },
  local: { label: "Bilgisayarımdaki model (Ollama, LM Studio)", short: "Yerel sunucu", cloud: false, models: [["llama3.1", "llama3.1"], ["qwen2.5", "qwen2.5"]] },
  device: {
    label: "Bu tarayıcıda (cihazda)", short: "Cihazda", cloud: false,
    models: [
      ["Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Qwen 2.5 1.5B · ~1 GB (önerilen)"],
      ["Qwen3-1.7B-q4f16_1-MLC", "Qwen 3 1.7B · ~1,1 GB"],
      ["Llama-3.2-3B-Instruct-q4f16_1-MLC", "Llama 3.2 3B · ~1,8 GB (daha iyi, daha yavaş)"],
    ],
  },
};

export const aiModelLabel = (ai: AiSettings): string => {
  if (ai.mode === "off") return "";
  const p = AI_PROVIDERS[ai.mode];
  const id = ai.models[ai.mode];
  return p.models.find(([m]) => m === id)?.[1].replace(/ \(.*\)$/, "").replace(/ ·.*$/, "") ?? id;
};

export interface Settings {
  names: Record<Color, string>;
  theme: ThemeSetting;
  pdfDark: PdfDark;
  uiSize: UiSize;
  panelWidth: number;
  railOpen: boolean;
  panelOpen: boolean;
  ai: AiSettings;
  pen: { color: InkColor; width: number; kind?: PenKind; custom?: string[] };
  /** İsteğe bağlı yerel hata günlüğü (hiçbir yere gönderilmez). */
  errorLog: boolean;
  /** Son açılanlar görünümü. */
  homeView?: "list" | "grid";
  /** Ses kaydı sırasında tarayıcının konuşma tanımasıyla canlı yazıya dökme (Chrome'da ses Google'a gider). */
  liveTranscribe?: boolean;
  /** Görüntülenen sayfalarda metni eksik/bozuk ya da resim içindeki yazıyı arka planda tanı (varsayılan açık). */
  autoOcr?: boolean;
}

export const DEFAULT_NAMES: Record<Color, string> = {
  1: "Önemli",
  2: "Anlamadım",
  3: "Sınavda çıkar",
  4: "Tanım",
};

export const DEFAULT_SETTINGS: Settings = {
  names: { ...DEFAULT_NAMES },
  theme: "system",
  pdfDark: "soften",
  uiSize: "normal",
  panelWidth: 344,
  railOpen: true,
  panelOpen: true,
  ai: {
    mode: "off",
    keys: { anthropic: "", openai: "", gemini: "" },
    models: { anthropic: "claude-opus-5-5", openai: "gpt-5-mini", gemini: "gemini-flash-latest", local: "llama3.1", device: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" },
    localUrl: "http://localhost:11434/v1",
  },
  pen: { color: "blue", width: 2 },
  errorLog: false,
};
