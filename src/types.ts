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
}

export type PenColor = "black" | "blue" | "red";
export const PEN_COLORS: readonly PenColor[] = ["black", "blue", "red"];
export type ShapeKind = "rect" | "ellipse" | "arrow";

/** Yaz modundaki işaret. Koordinatlar sayfaya göre 0–1 arası. */
export type Mark =
  | (MarkBase & { kind: "ink"; color: PenColor; width: number; points: [number, number][] })
  | (MarkBase & { kind: "shape"; color: PenColor; width: number; shape: ShapeKind; from: [number, number]; to: [number, number] })
  | (MarkBase & { kind: "text"; color: PenColor; box: Rect; text: string })
  | (MarkBase & { kind: "sticky"; box: Rect; text: string; collapsed?: boolean; ai?: boolean });

export interface MarkBase {
  id: string;
  fileHash: string;
  page: number;
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
  /** File System Access API tutamacı (yalnızca Chromium). */
  handle?: FileSystemFileHandle;
}

export type ThemeSetting = "light" | "dark" | "system";
export type PdfDark = "soften" | "original";
export type UiSize = "small" | "normal" | "large";

export type AiMode = "off" | "cloud";

export interface AiSettings {
  mode: AiMode;
  /** Yalnızca bu tarayıcıda saklanır; yedeğe girmez. */
  apiKey: string;
  model: string;
}

export const AI_MODELS: [string, string][] = [
  ["claude-opus-5-5", "Claude Opus 5.5 (en iyi)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (hızlı)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (en ucuz)"],
];

export interface Settings {
  names: Record<Color, string>;
  theme: ThemeSetting;
  pdfDark: PdfDark;
  uiSize: UiSize;
  panelWidth: number;
  railOpen: boolean;
  panelOpen: boolean;
  ai: AiSettings;
  pen: { color: PenColor; width: number };
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
  ai: { mode: "off", apiKey: "", model: "claude-opus-5-5" },
  pen: { color: "blue", width: 2 },
};
