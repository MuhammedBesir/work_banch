import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/600.css";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";

import type { PDFDocumentProxy } from "pdfjs-dist";
import * as db from "./db";
import { createBackup, parseBackup, restoreBackup } from "./backup";
import { num, percent } from "./format";
import { readingOrder, rotateRect } from "./geometry";
import { looksLikePdf, looksScanned, loadOutline, OpenError, openPdf } from "./pdf/load";
import { Viewer, type SelectionPart } from "./pdf/viewer";
import { PageEditor, type EditPage } from "./editor/pageEditor";
import type { Color, FileRecord, Highlight, Settings } from "./types";
import { COLORS } from "./types";
import { announce, download, h, isTyping, kbd, sha256, uid } from "./util";
import { confirmDialog } from "./ui/dialog";
import { askPassword, BIG_BYTES, BIG_PAGES, confirmBigFile, openExport, openSettings, openShortcuts } from "./ui/dialogs";
import { FloatBar } from "./ui/float";
import { Home, type RecentRow } from "./ui/home";
import { openMenu } from "./ui/menu";
import { Panel } from "./ui/panel";
import { Rail } from "./ui/rail";
import { Search } from "./ui/search";
import { toast } from "./ui/toast";

type FsHandle = FileSystemFileHandle & {
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
};
type PickerWindow = Window & { showOpenFilePicker?(o: unknown): Promise<FsHandle[]> };

interface OpenDoc {
  rec: FileRecord;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
  title: string;
}

/** Okuyucu ekranının parçaları; bir dosya açıkken yaşar. */
interface Reader {
  file: OpenDoc;
  root: HTMLElement;
  body: HTMLElement;
  band: HTMLElement;
  stage: HTMLElement;
  viewer: Viewer;
  panel: Panel;
  rail: Rail;
  float: FloatBar;
  search: Search;
  pageInput: HTMLInputElement;
  zoomLabel: HTMLElement;
  panelBtn: HTMLButtonElement;
  railBtn: HTMLButtonElement;
  themeBtn: HTMLButtonElement;
  modeSeg: HTMLElement;
  pageFlag: HTMLElement;
  editor: PageEditor | null;
}

const app = document.getElementById("app")!;
const isNarrow = () => matchMedia("(max-width: 1100px)").matches;

let settings: Settings;
let home: Home | null = null;
let reader: Reader | null = null;
let highlights: Highlight[] = [];
let byPage = new Map<number, Highlight[]>();
let pending: SelectionPart[] | null = null;
let activeId: string | null = null;
let lastColor: Color = 1;
let deleted: Highlight[][] = [];
let closeDeleteToast: (() => void) | null = null;
let railOpen = true;
let panelOpen = true;
let focusMode = false;
let persistAsked = false;

// ---------- Tema ve ayarlar ----------

function resolvedTheme(): "light" | "dark" {
  if (settings.theme !== "system") return settings.theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applySettings(): void {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme();
  root.dataset.pdfDark = settings.pdfDark;
  root.dataset.uiSize = settings.uiSize;
  if (reader) {
    reader.body.style.setProperty("--panel-width", `${settings.panelWidth}px`);
    reader.themeBtn.textContent = resolvedTheme() === "dark" ? "Açık tema" : "Koyu tema";
    reader.panel.setData(highlights, settings.names);
  }
}

async function changeSettings(next: Settings): Promise<void> {
  settings = next;
  applySettings();
  await db.saveSettings(settings);
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySettings);

function settingsDialog(): void {
  openSettings(settings, {
    change: (s) => void changeSettings(s),
    counts: () => Object.fromEntries(COLORS.map((c) => [c, highlights.filter((x) => x.color === c).length])) as Record<Color, number>,
    backup: async () => {
      const b = await createBackup();
      download(`calisma-masasi-yedek-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b, null, 2), "application/json");
      toast(`${num(b.highlights.length)} vurgu yedeklendi`);
    },
    restore: () => pickBackup(),
    wipe: () => void wipeAll(),
    shortcuts: openShortcuts,
  });
}

function pickBackup(): void {
  const input = h("input", { type: "file", accept: "application/json,.json" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const b = parseBackup(await file.text());
      const r = await restoreBackup(b);
      settings = await db.loadSettings();
      applySettings();
      if (reader) await reloadHighlights();
      else await showHome();
      toast(`${num(r.highlights)} vurgu ve ${num(r.files)} dosya kaydı geri yüklendi`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Yedek geri yüklenemedi.", undefined, 6000);
    }
  });
  input.click();
}

async function wipeAll(): Promise<void> {
  const total = (await db.allHighlights()).length;
  const ok = await confirmDialog({
    title: "Bu tarayıcıdaki tüm veriler silinsin mi?",
    text: `${num(total)} vurgu, notlar, yer imleri ve son açılanlar listesi kalıcı olarak silinir. Önce yedek almak istersen Ayarlar'dan .json yedeği indir.`,
    ok: `${num(total)} vurguyu sil`,
    danger: true,
  });
  if (!ok) return;
  await db.clearAll();
  settings = await db.loadSettings();
  applySettings();
  closeReader();
  await showHome();
  toast("Tüm veriler silindi");
}

// ---------- Dosya açma ----------

async function pickFile(): Promise<void> {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }], multiple: false });
      await openFile(await handle.getFile(), handle);
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") console.error(err);
    }
    return;
  }
  const input = h("input", { type: "file", accept: "application/pdf,.pdf" });
  input.addEventListener("change", () => input.files?.[0] && void openFile(input.files[0]));
  input.click();
}

function showOpenError(title: string, text: string, detail?: string): void {
  if (reader) {
    toast(`${title}. ${text}`, undefined, 7000);
    return;
  }
  void showHome().then(() => home?.showError({ title, text, detail }));
}

async function openFile(file: File, handle?: FsHandle): Promise<void> {
  let bigConfirmed = false;
  if (file.size > BIG_BYTES) {
    if (!(await confirmBigFile(file.name, file.size))) return;
    bigConfirmed = true;
  }
  const progress = home?.showLoading(file.name);
  progress?.(0, 0);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    showOpenError("Bu bir PDF değil", "Çalışma Masası yalnızca PDF açar.");
    return;
  }
  const hash = await sha256(bytes.buffer as ArrayBuffer);
  let doc: PDFDocumentProxy;
  try {
    // pdf.js veriyi işçiye aktarır; pdf-lib için kopya saklanır.
    doc = await openPdf(bytes.slice(), (wrong) => askPassword(file.name, wrong));
  } catch (err) {
    if (err instanceof OpenError && err.kind === "cancelled") {
      home?.showIdle();
      return;
    }
    showOpenError("Bu dosya açılamadı", `„${file.name}" bozuk ya da tamamen indirilmemiş olabilir. Dosyayı tekrar indirip yeniden dene.`, (err as OpenError).detail);
    return;
  }
  if (doc.numPages > BIG_PAGES && !bigConfirmed && !(await confirmBigFile(file.name, file.size, doc.numPages))) {
    await doc.destroy();
    home?.showIdle();
    return;
  }
  const existing = await db.getFile(hash);
  const rec: FileRecord = {
    hash,
    name: file.name,
    size: file.size,
    pageCount: doc.numPages,
    lastPage: Math.min(existing?.lastPage ?? 0, doc.numPages - 1),
    lastOpened: Date.now(),
    bookmarks: existing?.bookmarks ?? [],
    scrollMode: existing?.scrollMode,
    scannedDismissed: existing?.scannedDismissed,
    handle: handle ?? existing?.handle,
  };
  await db.putFile(rec);
  const meta = await doc.getMetadata().catch(() => null);
  const title = ((meta?.info as { Title?: string } | undefined)?.Title || "").trim() || file.name.replace(/\.pdf$/i, "");
  await openReader({ rec, bytes, doc, title });
}

async function openRecent(row: RecentRow): Promise<void> {
  const handle = row.rec.handle as FsHandle | undefined;
  if (handle) {
    try {
      const perm = (await handle.queryPermission?.({ mode: "read" })) ?? "granted";
      if (perm === "granted" || (await handle.requestPermission?.({ mode: "read" })) === "granted") {
        await openFile(await handle.getFile(), handle);
        return;
      }
    } catch {
      /* erişim kaybolmuş: yeniden seçtir */
    }
  }
  await pickFile();
}

// ---------- Boş durum ----------

async function showHome(): Promise<void> {
  home = new Home({
    pick: () => void pickFile(),
    openRecent: (row) => void openRecent(row),
    clearRecent: async () => {
      for (const f of await db.allFiles()) await db.deleteFile(f.hash);
      await refreshRecent();
    },
    settings: settingsDialog,
  });
  app.replaceChildren(home.el);
  document.title = "Çalışma Masası";
  await refreshRecent();
}

async function refreshRecent(): Promise<void> {
  const files = await db.allFiles();
  const rows: RecentRow[] = await Promise.all(files.map(async (rec) => ({
    rec,
    highlights: await db.countHighlights(rec.hash),
    reachable: !!rec.handle,
  })));
  home?.renderRecent(rows);
}

// ---------- Okuyucu ----------

function indexHighlights(): void {
  byPage = new Map();
  for (const hl of highlights) {
    const list = byPage.get(hl.page) ?? [];
    list.push(hl);
    byPage.set(hl.page, list);
  }
  for (const list of byPage.values()) list.sort(readingOrder);
}

function refreshHighlights(pages?: number[]): void {
  if (!reader) return;
  indexHighlights();
  if (pages) pages.forEach((p) => reader!.viewer.drawHighlights(p));
  else reader.viewer.redrawAllHighlights();
  reader.panel.setData(highlights, settings.names);
  reader.panelBtn.querySelector(".cm-num")!.textContent = num(highlights.length);
  const marks = new Map<number, Set<Color>>();
  for (const [p, list] of byPage) marks.set(p, new Set(list.map((x) => x.color)));
  reader.rail.setMarks(marks);
}

async function reloadHighlights(): Promise<void> {
  if (!reader) return;
  highlights = await db.highlightsFor(reader.file.rec.hash);
  refreshHighlights();
}

function closeReader(): void {
  if (!reader) return;
  reader.editor?.destroy();
  reader.viewer.destroy();
  reader.rail.destroy();
  void reader.file.doc.destroy();
  reader = null;
  highlights = [];
  pending = null;
  activeId = null;
  deleted = [];
  focusMode = false;
}

async function openReader(file: OpenDoc): Promise<void> {
  closeReader();
  home = null;
  highlights = await db.highlightsFor(file.rec.hash);
  indexHighlights();
  railOpen = settings.railOpen && !isNarrow();
  panelOpen = settings.panelOpen && !isNarrow();

  const ghost = (label: string | Node, attrs: Record<string, string | EventListener> = {}, ...rest: Node[]) =>
    h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", ...attrs }, label, ...rest);

  const railBtn = ghost("Sayfalar", { class: "cm-btn cm-btn--ghost cm-btn--sm is-desk", title: "Sayfa şeridi ( [ )", "aria-pressed": String(railOpen), onclick: () => toggleRail() });
  const fileBtn = h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-bar__file", title: file.rec.name, "aria-haspopup": "menu", text: file.rec.name });
  const fileMenu = (anchor: HTMLElement, mobile = false) => openMenu(anchor, [
    ...(mobile ? [
      { label: "Dışa aktar", run: () => exportDialog() },
      { label: resolvedTheme() === "dark" ? "Açık tema" : "Koyu tema", run: () => void changeSettings({ ...settings, theme: resolvedTheme() === "dark" ? "light" : "dark" }) },
      { label: "Sayfaya yer imi", shortcut: "B", run: () => toggleBookmark() },
      "sep" as const,
    ] : []),
    { label: "Başka dosya aç", shortcut: "Ctrl O", run: () => void pickFile() },
    { label: "Son açılanlar", run: () => void goHome() },
    "sep",
    { label: "Ayarlar", run: settingsDialog },
    { label: "Kısayollar", shortcut: "?", run: openShortcuts },
  ], mobile ? "right" : "left");
  fileBtn.addEventListener("click", () => fileMenu(fileBtn));
  const modeSeg = h("div", { class: "cm-seg cm-seg--sm is-desk", role: "group", "aria-label": "Mod" });
  const pageInput = h("input", { class: "cm-pageinput", value: String(file.rec.lastPage + 1), "aria-label": "Sayfa numarası (G)", inputmode: "numeric" });
  pageInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const n = parseInt(pageInput.value, 10);
      if (!Number.isNaN(n)) viewer.goTo(n - 1);
      viewer.stage.focus({ preventScroll: true });
    } else if (e.key === "Escape") {
      pageInput.value = String(viewer.current + 1);
      viewer.stage.focus({ preventScroll: true });
    }
  });
  pageInput.addEventListener("focus", () => pageInput.select());
  const zoomLabel = h("span", { class: "cm-num is-zoom", "aria-live": "polite" });
  const zoomBtn = ghost("Genişlik ▾", { "aria-haspopup": "menu" });
  zoomBtn.addEventListener("click", () => openMenu(zoomBtn, [
    { label: "Genişliğe sığdır", shortcut: "Ctrl 0", on: viewer.zoomMode === "width", run: () => viewer.setZoom("width") },
    { label: "Sayfaya sığdır", on: viewer.zoomMode === "page", run: () => viewer.setZoom("page") },
    "sep",
    ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => ({
      label: percent(z), on: viewer.zoomMode === "custom" && Math.abs(viewer.scale - z) < 0.01, run: () => viewer.setZoom("custom", z),
    })),
    "sep",
    { label: "Sürekli kaydırma", on: viewer.scrollMode === "continuous", run: () => setScrollMode("continuous") },
    { label: "Sayfa sayfa", hint: "slaytlar", on: viewer.scrollMode === "paged", run: () => setScrollMode("paged") },
  ]));
  const themeBtn = ghost("Koyu tema", { class: "cm-btn cm-btn--ghost cm-btn--sm is-wide", onclick: () => void changeSettings({ ...settings, theme: resolvedTheme() === "dark" ? "light" : "dark" }) });
  const panelBtn = ghost("İşaretler ", { title: "İşaretler paneli ( ] )", "aria-pressed": String(panelOpen), onclick: () => togglePanel() }, h("span", { class: "cm-num", text: num(highlights.length) }));
  const sep = () => h("span", { class: "cm-bar__sep" });

  const bar = h("header", { class: "cm-bar", role: "toolbar", "aria-label": "Okuyucu araç çubuğu" },
    h("div", { class: "cm-bar__group" }, railBtn, fileBtn),
    modeSeg,
    h("span", { class: "cm-bar__sep is-reader" }),
    h("div", { class: "cm-bar__group is-reader", "aria-label": "Sayfa" },
      ghost("‹", { "aria-label": "Önceki sayfa (K)", onclick: () => viewer.next(-1) }),
      pageInput,
      h("span", { class: "cm-muted cm-num", text: `/ ${num(file.doc.numPages)}` }),
      ghost("›", { "aria-label": "Sonraki sayfa (J)", onclick: () => viewer.next(1) }),
    ),
    h("span", { class: "cm-bar__sep is-wide is-reader" }),
    h("div", { class: "cm-bar__group is-wide is-reader", "aria-label": "Yakınlaştırma" },
      ghost("−", { "aria-label": "Uzaklaştır (Ctrl −)", onclick: () => viewer.zoomBy(1 / 1.1) }),
      zoomLabel,
      ghost("+", { "aria-label": "Yakınlaştır (Ctrl +)", onclick: () => viewer.zoomBy(1.1) }),
      zoomBtn,
    ),
    h("span", { class: "cm-bar__spacer" }),
    h("div", { class: "cm-bar__group is-reader is-desk" },
      ghost("Ara ", { onclick: () => search.open(window.getSelection()?.toString().trim() || undefined) }, kbd("Ctrl F")),
      themeBtn,
      ghost("Odak ", { class: "cm-btn cm-btn--ghost cm-btn--sm is-wide", onclick: () => setFocus(!focusMode) }, kbd("F")),
      h("button", { class: "cm-btn cm-btn--sm", onclick: () => exportDialog() }, "Dışa aktar"),
      sep(),
      panelBtn,
    ),
  );

  const stage = h("div", { class: "cm-stage", tabindex: "-1", "aria-label": "Belge" });
  const pageFlag = h("div", { class: "cm-pageflag cm-num", "aria-hidden": "true" });
  const stageWrap = h("main", { class: "cm-stagewrap", "aria-label": file.rec.name }, stage, pageFlag);
  const band = h("div", { class: "cm-band" });

  const float = new FloatBar({
    color: (c) => applyColor(c),
    note: () => noteFromFloat(),
    copy: () => copySelection(),
    remove: () => activeId && removeHighlight(activeId),
  });

  const viewer = new Viewer(stage, file.doc, {
    pageChange: (i) => onPageChange(i),
    selection: (parts) => onSelection(parts),
    selectionCleared: () => {
      pending = null;
      if (float.mode === "new" || float.mode === "applied") float.hide();
      activeId = null;
    },
    highlightClick: (id) => onHighlightClick(id),
    scroll: () => focusMode && flashPageFlag(),
    zoomChange: () => updateZoomLabel(),
  });

  const panel = new Panel(settings.names, {
    jump: (hl) => {
      viewer.reveal(hl.page, hl.rects[0], hl.id);
      if (isNarrow()) togglePanel(false);
    },
    saveNote: (id, note) => void saveNote(id, note),
    remove: (id) => removeHighlight(id),
    resize: (w) => {
      settings.panelWidth = w;
      reader?.body.style.setProperty("--panel-width", `${w}px`);
      clearTimeout(resizeSave);
      resizeSave = window.setTimeout(() => void db.saveSettings(settings), 300);
    },
  });

  const rail = new Rail(file.doc, {
    goTo: (i) => {
      viewer.goTo(i);
      if (isNarrow()) toggleRail(false);
    },
    wideChange: (wide) => reader?.body.classList.toggle("is-rail-wide", wide),
  });

  const search = new Search(file.doc, {
    show: async (m, q) => {
      if (!m) {
        viewer.showSearchHit(null, []);
        return;
      }
      viewer.goTo(m.page);
      const rects = await viewer.findRects(m.page, q, m.occurrence);
      viewer.showSearchHit(m.page, rects);
      if (rects[0]) viewer.reveal(m.page, rects[0]);
    },
    close: () => stage.focus({ preventScroll: true }),
  });
  stageWrap.append(search.el);

  const body = h("div", { class: "cm-body" }, rail.el, stageWrap, panel.el);
  // Mobil: yüzen çubuk ve kalabalık üst bar yerine alta sabit gezinme.
  const moreBtn = h("button", { class: "cm-btn cm-btn--ghost", "aria-haspopup": "menu" }, "Diğer");
  moreBtn.addEventListener("click", () => fileMenu(moreBtn, true));
  const mnav = h("nav", { class: "cm-mnav", "aria-label": "Gezinme" },
    h("button", { class: "cm-btn cm-btn--ghost", onclick: () => toggleRail() }, "Sayfalar"),
    h("button", { class: "cm-btn cm-btn--ghost", onclick: () => togglePanel() }, "Vurgular"),
    h("button", { class: "cm-btn cm-btn--ghost", onclick: () => search.open() }, "Ara"),
    moreBtn,
  );
  const root = h("div", { class: "cm-app" }, bar, band, body, mnav);
  app.replaceChildren(root);
  document.title = `${file.rec.name} — Çalışma Masası`;

  reader = {
    file, root, body, band, stage, viewer, panel, rail, float, search, pageInput, zoomLabel,
    panelBtn, railBtn, themeBtn, modeSeg, pageFlag, editor: null,
  };
  renderModeSeg("read");
  applySettings();
  updateLayout();
  bindFocusPeek(root);

  await viewer.init((p) => byPage.get(p) ?? [], file.rec.lastPage);
  if (file.rec.scrollMode && file.rec.scrollMode !== viewer.scrollMode) viewer.setScrollMode(file.rec.scrollMode);
  updateZoomLabel();
  onPageChange(viewer.current);
  refreshHighlights();
  rail.setBookmarks(file.rec.bookmarks);
  stage.focus({ preventScroll: true });
  if (file.rec.lastPage > 0) toast(`Kaldığın yerden: sayfa ${num(file.rec.lastPage + 1)}`);

  void loadOutline(file.doc).then((o) => reader?.file === file && rail.setOutline(o)).catch(() => {});
  if (!file.rec.scannedDismissed) {
    void looksScanned(file.doc).then((scanned) => scanned && reader?.file === file && showScannedBand());
  }
}

let resizeSave = 0;
let lastPageSave = 0;

function onPageChange(i: number): void {
  if (!reader) return;
  if (document.activeElement !== reader.pageInput) reader.pageInput.value = String(i + 1);
  reader.rail.setCurrent(i);
  reader.panel.pageChanged(i);
  reader.file.rec.lastPage = i;
  clearTimeout(lastPageSave);
  lastPageSave = window.setTimeout(() => reader && void db.putFile({ ...reader.file.rec, lastOpened: Date.now() }), 600);
}

function updateZoomLabel(): void {
  if (!reader) return;
  reader.zoomLabel.textContent = percent(reader.viewer.scale);
}

function setScrollMode(mode: "continuous" | "paged"): void {
  if (!reader) return;
  reader.viewer.setScrollMode(mode);
  reader.file.rec.scrollMode = mode; // dosya başına hatırlanır
  void db.putFile(reader.file.rec);
  updateZoomLabel();
}

function showScannedBand(): void {
  if (!reader) return;
  const r = reader;
  r.band.replaceChildren(
    h("div", { class: "cm-notice cm-notice--warn", role: "status" },
      h("span", { class: "cm-notice__sym", "aria-hidden": "true", text: "!" }),
      h("div", {},
        h("p", { class: "cm-notice__title", text: "Bu dosyada seçilebilir metin yok" }),
        h("p", { class: "cm-notice__text", text: "Taranmış bir belge gibi görünüyor. Okuyabilir ve yer imi ekleyebilirsin, ama metin vurgulama ve arama çalışmaz." }),
        h("div", { style: "display:flex;gap:8px" },
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => {
            r.band.replaceChildren();
            r.file.rec.scannedDismissed = true; // dosya başına hatırlanır
            void db.putFile(r.file.rec);
          } }, "Anladım, gizle"),
        ),
      ),
    ),
  );
}

// ---------- Paneller, odak modu ----------

function updateLayout(): void {
  if (!reader) return;
  const { body, root, railBtn, panelBtn } = reader;
  const narrow = isNarrow();
  body.classList.toggle("no-rail", !railOpen && !narrow);
  body.classList.toggle("is-drawer-rail", railOpen && narrow);
  body.classList.toggle("no-panel", !panelOpen);
  root.classList.toggle("is-focus", focusMode);
  railBtn.classList.toggle("is-on", railOpen);
  railBtn.setAttribute("aria-pressed", String(railOpen));
  panelBtn.classList.toggle("is-on", panelOpen);
  panelBtn.setAttribute("aria-pressed", String(panelOpen));
}

function toggleRail(on = !railOpen): void {
  railOpen = on;
  if (!isNarrow()) void changeSettings({ ...settings, railOpen: on });
  updateLayout();
}

function togglePanel(on = !panelOpen): void {
  panelOpen = on;
  if (!isNarrow()) void changeSettings({ ...settings, panelOpen: on });
  updateLayout();
}

function setFocus(on: boolean): void {
  focusMode = on;
  updateLayout();
  if (on) {
    flashPageFlag();
    toast("Odak modu · çıkmak için Esc ya da F");
  }
  reader?.stage.focus({ preventScroll: true });
}

let flagTimer = 0;
function flashPageFlag(): void {
  if (!reader) return;
  const f = reader.pageFlag;
  f.textContent = `${num(reader.viewer.current + 1)} / ${num(reader.viewer.pageCount)}`;
  f.classList.add("is-on");
  clearTimeout(flagTimer);
  flagTimer = window.setTimeout(() => f.classList.remove("is-on"), 2000);
}

/** Odak modunda fare üst kenara 8px yaklaşınca üst bar geçici olarak geri gelir. */
function bindFocusPeek(root: HTMLElement): void {
  root.addEventListener("mousemove", (e) => {
    if (!focusMode) return;
    const bar = root.querySelector(".cm-bar") as HTMLElement;
    const peek = root.classList.contains("is-peek");
    if (e.clientY <= 8) root.classList.add("is-peek");
    else if (peek && !bar.contains(e.target as Node) && e.clientY > bar.offsetHeight + 8) root.classList.remove("is-peek");
  });
}

// ---------- Modlar ----------

function renderModeSeg(mode: "read" | "edit"): void {
  if (!reader) return;
  const btn = (m: "read" | "edit", label: string, key: string) =>
    h("button", { class: mode === m ? "is-on" : "", "aria-pressed": String(mode === m), title: `${label} (${key})`, onclick: () => void setMode(m) }, label);
  // Yaz modu v1.1 ile gelir; o zamana kadar seçicide yer almaz.
  reader.modeSeg.replaceChildren(btn("read", "Oku", "Alt 1"), btn("edit", "Düzenle", "Alt 3"));
}

async function setMode(mode: "read" | "edit"): Promise<void> {
  if (!reader) return;
  const r = reader;
  if (mode === "edit" && !r.editor) {
    hideFloat();
    r.search.el.hidden = true;
    const editor = new PageEditor(
      { id: "main", name: r.file.rec.name, bytes: r.file.bytes, doc: r.file.doc },
      { saved: (out, name, pages) => void onEditorSaved(out, name, pages), askPassword: (n, w) => askPassword(n, w) },
    );
    r.editor = editor;
    r.body.hidden = true;
    r.root.classList.add("is-edit");
    r.root.insertBefore(editor.el, r.body.nextSibling);
    renderModeSeg("edit");
    editor.focus();
  } else if (mode === "read" && r.editor) {
    if (r.editor.changes) {
      const ok = await confirmDialog({
        title: "Kaydedilmemiş değişiklikler var",
        text: `${num(r.editor.changes)} sayfa değişikliği kaydedilmedi. Okuma moduna dönersen kaybolur.`,
        ok: "Kaydetmeden çık",
        danger: true,
      });
      if (!ok) return;
    }
    r.editor.destroy();
    r.editor.el.remove();
    r.editor = null;
    r.body.hidden = false;
    r.root.classList.remove("is-edit");
    renderModeSeg("read");
    r.viewer.scheduleRender(0);
    r.stage.focus({ preventScroll: true });
  }
}

/** Düzenle modunda kaydedilen kopya: vurgular ve yer imleri sayfalarıyla birlikte yeni dosyaya taşınır. */
async function onEditorSaved(out: Uint8Array, name: string, pages: EditPage[]): Promise<void> {
  if (!reader) return;
  const hash = await sha256(out.slice().buffer as ArrayBuffer);
  const moved: Highlight[] = [];
  const bookmarks: number[] = [];
  pages.forEach((p, newIndex) => {
    if (p.src !== "main") return;
    for (const hl of byPage.get(p.index) ?? []) {
      moved.push({ ...hl, id: uid(), fileHash: hash, page: newIndex, rects: hl.rects.map((r) => rotateRect(r, p.rotation)), updatedAt: Date.now() });
    }
    if (reader!.file.rec.bookmarks.includes(p.index)) bookmarks.push(newIndex);
  });
  await db.putHighlights(moved);
  await db.putFile({ hash, name, size: out.byteLength, pageCount: pages.length, lastPage: 0, lastOpened: Date.now() - 1, bookmarks });
  download(name, out, "application/pdf");
  toast(`Kopya kaydedildi: ${name}${moved.length ? ` · ${num(moved.length)} vurgu taşındı` : ""}`, {
    label: "Kopyayı aç",
    run: () => void openFile(new File([out], name, { type: "application/pdf" })),
  }, 10000);
}

async function goHome(): Promise<void> {
  if (reader?.editor?.changes) {
    await setMode("read");
    if (reader?.editor) return;
  }
  closeReader();
  await showHome();
}

// ---------- Vurgular ----------

function onSelection(parts: SelectionPart[]): void {
  if (!reader) return;
  pending = parts;
  activeId = null;
  showFloatFor(parts[0].page, parts[0].rects, "new");
}

function showFloatFor(page: number, rects: Highlight["rects"], mode: "new" | "applied", color?: Color): void {
  if (!reader) return;
  const pageEl = reader.viewer.pageElement(page);
  if (!pageEl || !rects.length) return;
  const first = reader.viewer.rectPx(page, rects[0]);
  const last = reader.viewer.rectPx(page, rects[rects.length - 1]);
  const left = Math.min(...rects.map((r) => reader!.viewer.rectPx(page, r).left));
  const right = Math.max(...rects.map((r) => { const x = reader!.viewer.rectPx(page, r); return x.left + x.width; }));
  reader.float.show(
    { pageEl, top: first.top, bottom: last.top + last.height, left, right },
    mode, settings.names, color, reader.stage.getBoundingClientRect().top,
  );
}

function hideFloat(): void {
  reader?.float.hide();
  pending = null;
  activeId = null;
}

function onHighlightClick(id: string): void {
  const hl = highlights.find((x) => x.id === id);
  if (!hl || !reader) return;
  pending = null;
  activeId = id;
  reader.panel.select(id);
  showFloatFor(hl.page, hl.rects, "applied", hl.color);
}

async function createFromPending(color: Color): Promise<Highlight[]> {
  if (!pending || !reader) return [];
  const now = Date.now();
  const created = pending.map<Highlight>((p) => ({
    id: uid(), fileHash: reader!.file.rec.hash, page: p.page, color, rects: p.rects, text: p.text, note: "", createdAt: now, updatedAt: now,
  }));
  highlights.push(...created);
  pending = null;
  window.getSelection()?.removeAllRanges();
  lastColor = color;
  reader.panel.markNew(created[0].id);
  refreshHighlights(created.map((c) => c.page));
  announce(`${settings.names[color]} olarak vurgulandı, sayfa ${created[0].page + 1}`);
  await db.putHighlights(created);
  if (!persistAsked) {
    persistAsked = true;
    void db.requestPersistence();
  }
  return created;
}

async function applyColor(color: Color): Promise<void> {
  if (!reader) return;
  if (pending) {
    const [hl] = await createFromPending(color);
    // Araç çubuğu "uygulandı" haline geçer.
    if (hl) {
      activeId = hl.id;
      showFloatFor(hl.page, hl.rects, "applied", color);
      if (focusMode) toast(`${settings.names[color]} olarak vurgulandı`, undefined, 2000);
    }
    return;
  }
  const hl = highlights.find((x) => x.id === activeId);
  if (!hl) return;
  hl.color = color;
  hl.updatedAt = Date.now();
  lastColor = color;
  refreshHighlights([hl.page]);
  showFloatFor(hl.page, hl.rects, "applied", color);
  announce(`${settings.names[color]} olarak değiştirildi`);
  await db.putHighlight(hl);
}

async function noteFromFloat(): Promise<void> {
  if (!reader) return;
  let id = activeId;
  if (pending) id = (await createFromPending(lastColor))[0]?.id ?? null;
  if (!id) return;
  hideFloat();
  if (focusMode) setFocus(false);
  if (!panelOpen) togglePanel(true);
  reader.panel.editNote(id);
}

function copySelection(): void {
  const text = pending?.map((p) => p.text).join(" ") ?? highlights.find((x) => x.id === activeId)?.text;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast("Kopyalandı"), () => toast("Kopyalanamadı"));
}

async function saveNote(id: string, note: string): Promise<void> {
  const hl = highlights.find((x) => x.id === id);
  if (!hl || hl.note === note) return;
  hl.note = note;
  hl.updatedAt = Date.now();
  await db.putHighlight(hl);
}

function removeHighlight(id: string): void {
  const hl = highlights.find((x) => x.id === id);
  if (!hl || !reader) return;
  highlights = highlights.filter((x) => x.id !== id);
  deleted.push([hl]);
  hideFloat();
  refreshHighlights([hl.page]);
  void db.deleteHighlight(id);
  announce("Vurgu silindi");
  closeDeleteToast?.();
  closeDeleteToast = toast("Vurgu silindi", { label: "Geri al", shortcut: "Ctrl Z", run: () => void undoDelete() });
}

async function undoDelete(): Promise<void> {
  const batch = deleted.pop();
  if (!batch || !reader) return;
  closeDeleteToast?.();
  closeDeleteToast = null;
  highlights.push(...batch);
  refreshHighlights(batch.map((x) => x.page));
  await db.putHighlights(batch);
  announce("Vurgu geri alındı");
}

function toggleBookmark(): void {
  if (!reader) return;
  const rec = reader.file.rec;
  const p = reader.viewer.current;
  const has = rec.bookmarks.includes(p);
  rec.bookmarks = has ? rec.bookmarks.filter((x) => x !== p) : [...rec.bookmarks, p];
  reader.rail.setBookmarks(rec.bookmarks);
  void db.putFile(rec);
  toast(has ? `Sayfa ${num(p + 1)} yer iminden çıkarıldı` : `Sayfa ${num(p + 1)} yer imlerine eklendi`);
}

function exportDialog(): void {
  if (!reader) return;
  if (!highlights.length) {
    toast("Dışa aktaracak vurgu yok. Önce sayfada metni seçip vurgula.");
    return;
  }
  openExport({ title: reader.file.title, fileName: reader.file.rec.name, highlights, names: settings.names });
}

// ---------- Klavye ----------

document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (ctrl && key === "o") {
    e.preventDefault();
    void pickFile();
    return;
  }
  if (!reader) return;
  const r = reader;

  if (e.altKey && !ctrl && (e.code === "Digit1" || e.code === "Digit3")) {
    e.preventDefault();
    void setMode(e.code === "Digit1" ? "read" : "edit");
    return;
  }
  if (r.editor) {
    if (r.editor.handleKey(e)) e.preventDefault();
    return;
  }
  if (ctrl) {
    if (key === "f") (e.preventDefault(), r.search.open(window.getSelection()?.toString().trim() || undefined));
    else if (key === "+" || key === "=") (e.preventDefault(), r.viewer.zoomBy(1.1));
    else if (key === "-") (e.preventDefault(), r.viewer.zoomBy(1 / 1.1));
    else if (key === "0") (e.preventDefault(), r.viewer.setZoom("width"));
    else if (key === "z" && !isTyping(e) && deleted.length) (e.preventDefault(), void undoDelete());
    else if (key === "j") (e.preventDefault(), togglePanel(true), r.panel.focusList());
    return;
  }
  if (isTyping(e) || e.altKey) return;

  const selecting = !!pending || r.float.mode === "applied";
  if (selecting && /^[1-4]$/.test(e.key)) return e.preventDefault(), void applyColor(Number(e.key) as Color);
  if (selecting && key === "n") return e.preventDefault(), void noteFromFloat();
  if (selecting && key === "c") return e.preventDefault(), copySelection();
  if (r.float.mode === "applied" && (e.key === "Delete" || e.key === "Backspace") && activeId) return e.preventDefault(), removeHighlight(activeId);
  if (selecting && e.key === "Tab" && r.float.open && !r.float.el.contains(document.activeElement)) return e.preventDefault(), r.float.focus();

  switch (e.key) {
    case "Escape":
      if (r.float.open || pending) {
        window.getSelection()?.removeAllRanges();
        hideFloat();
      } else if (r.search.isOpen) r.search.close();
      else if (focusMode) setFocus(false);
      else return;
      break;
    case "j": case "J": case "ArrowRight":
      r.viewer.next(1);
      break;
    case "k": case "K": case "ArrowLeft":
      r.viewer.next(-1);
      break;
    case "PageDown": case " ":
      if (r.viewer.scrollMode !== "paged" || e.shiftKey) return;
      r.viewer.next(1);
      break;
    case "PageUp":
      if (r.viewer.scrollMode !== "paged") return;
      r.viewer.next(-1);
      break;
    case "g": case "G":
      r.pageInput.focus();
      break;
    case "f": case "F":
      setFocus(!focusMode);
      break;
    case "[":
      toggleRail();
      break;
    case "]":
      togglePanel();
      break;
    case "b": case "B":
      toggleBookmark();
      break;
    case "?":
      openShortcuts();
      break;
    default:
      return;
  }
  e.preventDefault();
});

// Pencereye bırakılan PDF her ekranda kabul edilir.
let dragDepth = 0;
let cover: HTMLElement | null = null;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  const item = e.dataTransfer?.items?.[0];
  if (home) home.showOver("", "");
  else if (!cover) {
    cover = h("div", { class: "cm-dropcover cm" }, h("section", { class: "cm-drop is-over" },
      h("p", { class: "cm-display", style: "font-size:24px;line-height:30px", text: "Bırak, açalım" }),
      h("p", { class: "cm-muted", style: "margin:0", text: item?.type && item.type !== "application/pdf" ? "Bu bir PDF değil gibi görünüyor." : "Açık dosyan kapanır, vurguları saklı kalır." }),
    ));
    document.body.append(cover);
  }
});
window.addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault());
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e) || --dragDepth > 0) return;
  dragDepth = 0;
  cover?.remove();
  cover = null;
  home?.showIdle();
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  cover?.remove();
  cover = null;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  // Chromium bırakılan dosyanın tutamacını da verir: "Son açılanlar"dan yeniden açılabilsin.
  type HandleItem = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };
  const handlePromise = (e.dataTransfer?.items?.[0] as HandleItem | undefined)?.getAsFileSystemHandle?.().catch(() => null);
  if (reader?.editor?.changes) {
    toast("Düzenle modunda kaydedilmemiş değişiklikler var. Önce kaydet ya da Oku moduna dön.");
    return;
  }
  void (async () => {
    const handle = await handlePromise;
    await openFile(file, handle?.kind === "file" ? (handle as FsHandle) : undefined);
  })();
});

// Sayfa kapanırken kaldığın yer kaydedilsin.
window.addEventListener("pagehide", () => {
  if (reader) void db.putFile({ ...reader.file.rec, lastOpened: Date.now() });
});
window.addEventListener("beforeunload", (e) => {
  if (reader?.editor?.changes) e.preventDefault();
});
matchMedia("(max-width: 1100px)").addEventListener("change", () => updateLayout());

// ---------- Başlangıç ----------

async function boot(): Promise<void> {
  settings = await db.loadSettings();
  applySettings();
  await showHome();
}

void boot().catch((err) => {
  console.error(err);
  app.replaceChildren(h("div", { class: "cm-home" },
    h("div", { class: "cm-notice cm-notice--err", role: "alert" },
      h("span", { class: "cm-notice__sym", "aria-hidden": "true", text: "×" }),
      h("div", {},
        h("p", { class: "cm-notice__title", text: "Çalışma Masası başlatılamadı" }),
        h("p", { class: "cm-notice__text", text: "Bu tarayıcı yerel saklamaya (IndexedDB) izin vermiyor olabilir; gizli pencerede ya da site verileri engelliyken olur. Normal bir pencerede yeniden dene." }),
      ),
    ),
  ));
});

