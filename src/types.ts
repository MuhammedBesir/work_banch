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

export interface Settings {
  names: Record<Color, string>;
  theme: ThemeSetting;
  pdfDark: PdfDark;
  uiSize: UiSize;
  panelWidth: number;
  railOpen: boolean;
  panelOpen: boolean;
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
};
