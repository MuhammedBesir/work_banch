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
import { dateLong, num, percent, relative } from "./format";
import { readingOrder } from "./geometry";
import { editMark, editRect } from "./editor/transform";
import { recognizeCanvas, recognizePage, stopOcr, type OcrPage } from "./ocr/ocr";
import { openHandwriting } from "./ui/handwriting";
import { rasterInk } from "./write/raster";
import { unionBox } from "./write/geometry";
import { looksLikePdf, looksScanned, loadOutline, OpenError, openPdf, pageText, type OutlineItem } from "./pdf/load";
import { Viewer, type SelectionPart } from "./pdf/viewer";
import { PageEditor, type EditPage } from "./editor/pageEditor";
import { chatMarkdown, type AiContext, type Cite, type SavedTurn } from "./ai/prompt";
import type { AiSettings, Card, Color, FileRecord, Highlight, Mark, Rect, Settings } from "./types";
import { COLORS } from "./types";
import { announce, download, h, isTyping, kbd, sha256, uid } from "./util";
import { confirmDialog } from "./ui/dialog";
import { AiPanel, type Scope } from "./ui/ai";
import { askPassword, BIG_BYTES, BIG_PAGES, confirmBigFile, openAiSetup, openExport, openSettings, openShortcuts } from "./ui/dialogs";
import { markBox } from "./write/geometry";
import { renderMarks } from "./write/layer";
import { toggleCheck } from "./write/rich";
import { WriteMode } from "./write/writeMode";
import { ReviewScreen } from "./review/review";
import { freshSchedule, parseSuggestions } from "./review/srs";
import { FloatBar } from "./ui/float";
import { Home, type RecentRow } from "./ui/home";
import { openMenu } from "./ui/menu";
import { Panel } from "./ui/panel";
import { Rail } from "./ui/rail";
import { Search } from "./ui/search";
import { toast } from "./ui/toast";
import { canInstall, install, isInstalled, registerPwa } from "./app/pwa";
import { clearErrors, installErrorLog, readErrors, setErrorLog } from "./app/errors";
import { backupDue, markBackedUp, snoozeBackup } from "./app/backupReminder";
import { copiesUsage, deleteAllCopies, hasCopy, opfsSupported, readCopy, saveCopy } from "./app/opfs";
import { bytes as fmtBytes } from "./format";
import { openDialog } from "./ui/dialog";

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
  write: WriteMode;
  ai: AiPanel;
  aiBtn: HTMLButtonElement;
  rtabs: HTMLElement;
  outline: OutlineItem[];
  mode: Mode;
}

type Mode = "read" | "write" | "edit";

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
let marks: Mark[] = [];
let cards: Card[] = [];
let review: ReviewScreen | null = null;
let marksByPage = new Map<number, Mark[]>();
/** Taranmış sayfaların OCR sonucu (meta `ocr:<hash>`), sayfa → metin ve kelime kutuları. */
let ocrPages = new Map<number, OcrPage>();
let ocrRun: { stop: boolean } | null = null;
/** Tanınmış el yazısı (meta `hw:<hash>`): sayfa → kelimeler ve hangi çizimlerden tanındığı. */
let hwPages = new Map<number, OcrPage & { sig: string }>();
let hwRun: { stop: boolean } | null = null;
let rightTab: "marks" | "ai" = "marks";
/** Son metin seçimi: AI'nın "Seçim" kapsamı için (Sor düğmesine basınca seçim kaybolsa da kalır). */
let lastSelection: SelectionPart[] | null = null;

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
  setErrorLog(settings.errorLog);
  if (reader) {
    reader.body.style.setProperty("--panel-width", `${settings.panelWidth}px`);
    reader.themeBtn.textContent = resolvedTheme() === "dark" ? "Açık tema" : "Koyu tema";
    reader.panel.setData(highlights, settings.names, marks);
    updateAiUi();
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
    backup: () => void backupNow(),
    restore: () => pickBackup(),
    wipe: () => void wipeAll(),
    shortcuts: openShortcuts,
    ai: aiSetup,
    install: () => void install(),
    installed: isInstalled() && !canInstall(),
    copies: {
      usage: async () => {
        const u = await copiesUsage();
        return u.count ? `${num(u.count)} PDF kopyası · ${fmtBytes(u.bytes)}` : "";
      },
      clear: async () => {
        await deleteAllCopies();
        toast("Tarayıcıdaki PDF kopyaları silindi; vurguların duruyor");
        if (home) void refreshRecent();
      },
    },
    errors: {
      view: async () => {
        const list = await readErrors();
        const d = openDialog({ title: "Hata günlüğü", width: 720 });
        d.body.append(list.length
          ? h("pre", { class: "cm-code", style: "max-height:420px;overflow:auto", text: list.map((e) => `${new Date(e.at).toLocaleString("tr-TR")} · ${e.kind} · v${e.version}\n${e.message}${e.stack ? `\n${e.stack}` : ""}`).join("\n\n") })
          : h("p", { style: "margin:0", text: settings.errorLog ? "Kayıtlı hata yok." : "Günlük kapalı. Açınca bundan sonraki hatalar bu tarayıcıda kaydedilir." }));
      },
      download: async () => download(`calisma-masasi-hatalar-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await readErrors(), null, 2), "application/json"),
      clear: async () => (await clearErrors(), toast("Hata günlüğü temizlendi")),
    },
  });
}

/** JSON yedek: indirilir ve son yedek zamanı hatırlanır (hatırlatma için). */
async function backupNow(): Promise<void> {
  const b = await createBackup();
  download(`calisma-masasi-yedek-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b, null, 2), "application/json");
  await markBackedUp();
  toast(`${num(b.highlights.length)} vurgu, ${num(b.marks?.length ?? 0)} işaret ve ${num(b.cards?.length ?? 0)} kart yedeklendi`);
  if (home) void refreshRecent();
}

/** Düzenli yedek hatırlatması: okumayı engellemez, ertelenebilir. */
async function backupNotice(): Promise<HTMLElement | null> {
  const total = (await db.allHighlights()).length + (await db.allMarks()).length;
  const { due, lastAt } = await backupDue(total);
  if (!due) return null;
  const box = h("div", { class: "cm-notice cm-notice--warn", role: "status" },
    h("span", { class: "cm-notice__sym", "aria-hidden": "true", text: "!" }),
    h("div", {},
      h("p", { class: "cm-notice__title", text: lastAt ? `Son yedeğin ${relative(lastAt)} alındı` : "Henüz yedek almadın" }),
      h("p", { class: "cm-notice__text", text: `${num(total)} vurgu ve işaret yalnızca bu tarayıcıda. Tarayıcı verisi silinirse ya da bilgisayar değişirse kaybolur.` }),
      h("div", { style: "display:flex;gap:8px" },
        h("button", { class: "cm-btn cm-btn--sm", onclick: () => void backupNow().then(() => box.remove()) }, "Şimdi yedekle (.json)"),
        h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => void snoozeBackup().then(() => box.remove()) }, "3 gün sonra hatırlat"),
      ),
    ),
  );
  return box;
}

function aiSetup(): void {
  const webgpu = import("./ai/device").then((m) => m.webgpuStatus()).catch(() => ({ ok: false, reason: "WebGPU denetlenemedi." }));
  openAiSetup(settings.ai, (ai: AiSettings) => void changeSettings({ ...settings, ai }), webgpu);
}

const aiOn = () => settings.ai.mode !== "off";

/** AI kapalıyken AI'a dair hiçbir düğme görünmez. */
function updateAiUi(): void {
  if (!reader) return;
  const on = aiOn();
  reader.aiBtn.hidden = !on;
  reader.rtabs.hidden = !on;
  if (!on && rightTab === "ai") showRightTab("marks");
  if (on && rightTab === "ai") reader.ai.refresh();
}

function showRightTab(tab: "marks" | "ai"): void {
  if (!reader) return;
  rightTab = tab;
  reader.panel.el.hidden = tab !== "marks";
  reader.ai.el.hidden = tab !== "ai";
  reader.rtabs.querySelectorAll<HTMLButtonElement>(".cm-tab").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-selected", String(on));
  });
  reader.aiBtn.classList.toggle("is-on", tab === "ai" && panelOpen);
  reader.aiBtn.setAttribute("aria-pressed", String(tab === "ai" && panelOpen));
  if (tab === "ai") reader.ai.refresh();
}

/** Ctrl J: AI sekmesini aç/kapat. */
function toggleAi(): void {
  if (!reader || !aiOn()) return;
  if (panelOpen && rightTab === "ai") {
    showRightTab("marks");
    return;
  }
  if (!panelOpen) togglePanel(true);
  if (focusMode) setFocus(false);
  showRightTab("ai");
  reader.ai.focus();
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
      if (reader) {
        await reloadHighlights();
        marks = await db.marksFor(reader.file.rec.hash);
        cards = await db.cardsFor(reader.file.rec.hash);
        refreshMarks();
      }
      else await showHome();
      toast(`${num(r.highlights)} vurgu, ${num(r.marks)} işaret ve ${num(r.files)} dosya kaydı geri yüklendi`);
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
  await deleteAllCopies();
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
    // Aynı içerik farklı adla açıldıysa eski ad hatırlanır; vurgular içeriğe bağlı olduğu için geri gelir.
    aliases: [...new Set([...(existing?.aliases ?? []), ...(existing && existing.name !== file.name ? [existing.name] : [])])].filter((n) => n !== file.name),
  };
  await db.putFile(rec);
  // Tutamaç saklanamayan tarayıcılarda (Firefox, Safari) son açılanlardan yeniden açmak için kopya.
  if (!rec.handle && opfsSupported()) void saveCopy(hash, bytes);
  if (existing && existing.name !== file.name) {
    const n = await db.countHighlights(hash);
    toast(`Bu dosyayı daha önce „${existing.name}" adıyla açmıştın${n ? `; ${num(n)} vurgun geri geldi` : ""}.`, undefined, 6000);
  }
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
      /* erişim kaybolmuş: tarayıcıdaki kopyaya ya da yeniden seçmeye düş */
    }
  }
  const copy = await readCopy(row.rec.hash, row.rec.name);
  if (copy) {
    await openFile(copy);
    return;
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
      await deleteAllCopies();
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
    reachable: !!rec.handle || await hasCopy(rec.hash),
  })));
  home?.renderRecent(rows);
  home?.setNotice(await backupNotice());
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
  reader.panel.setData(highlights, settings.names, marks);
  updatePanelCount();
  const dots = new Map<number, Set<Color>>();
  for (const [p, list] of byPage) dots.set(p, new Set(list.map((x) => x.color)));
  reader.rail.setMarks(dots);
}

function updatePanelCount(): void {
  if (!reader) return;
  const n = highlights.length + marks.filter((m) => !((m.kind === "text" || m.kind === "sticky") && !m.text.trim())).length;
  reader.panelBtn.querySelector(".cm-num")!.textContent = num(n);
}

// ---------- Yaz modu işaretleri ----------

function indexMarks(): void {
  marksByPage = new Map();
  for (const m of marks) marksByPage.set(m.page, [...(marksByPage.get(m.page) ?? []), m]);
}

function drawMarks(page: number): void {
  if (!reader) return;
  const el = reader.viewer.pageElement(page);
  const list = marksByPage.get(page) ?? [];
  if (!el || (!list.length && !el.querySelector(".cm-page__marks"))) return;
  renderMarks(el, page, list, {
    editable: reader.write.editableMarks,
    selected: reader.write.selected,
    scale: reader.viewer.scale,
    onSticky: (id, collapsed) => {
      const m = marks.find((x) => x.id === id);
      if (m?.kind === "sticky") updateMark({ ...m, collapsed });
    },
    onToggle: (id, line) => {
      const m = marks.find((x) => x.id === id);
      if (m && (m.kind === "text" || m.kind === "sticky")) updateMark({ ...m, text: toggleCheck(m.text, line), updatedAt: Date.now() });
    },
  });
}

function refreshMarks(pages?: number[]): void {
  if (!reader) return;
  indexMarks();
  const list = pages ?? [...Array(reader.viewer.pageCount).keys()];
  list.forEach(drawMarks);
  reader.rail.setDrawings(marksByPage);
  reader.panel.setData(highlights, settings.names, marks);
  updatePanelCount();
}

function addMark(m: Mark): void {
  marks = [...marks.filter((x) => x.id !== m.id), m];
  refreshMarks([m.page]);
  void db.putMark(m);
}

function updateMark(m: Mark): void {
  const old = marks.find((x) => x.id === m.id);
  marks = marks.map((x) => (x.id === m.id ? m : x));
  refreshMarks([...new Set([m.page, old?.page ?? m.page])]);
  void db.putMark(m);
}

function removeMark(id: string): void {
  const m = marks.find((x) => x.id === id);
  if (!m) return;
  marks = marks.filter((x) => x.id !== id);
  refreshMarks([m.page]);
  void db.deleteMark(id);
}

/** Panelden silinen işaret: vurgu silme gibi 6 sn geri alınabilir. */
function removeMarkWithUndo(id: string): void {
  const m = marks.find((x) => x.id === id);
  if (!m) return;
  removeMark(id);
  toast("İşaret silindi", { label: "Geri al", run: () => addMark(m) });
}

async function reloadHighlights(): Promise<void> {
  if (!reader) return;
  highlights = await db.highlightsFor(reader.file.rec.hash);
  refreshHighlights();
}

function closeReader(): void {
  if (!reader) return;
  if (ocrRun) {
    ocrRun.stop = true;
    void stopOcr();
  }
  review?.el.remove();
  review = null;
  reader.editor?.destroy();
  reader.write.disable();
  reader.viewer.destroy();
  reader.rail.destroy();
  void reader.file.doc.destroy();
  reader = null;
  highlights = [];
  marks = [];
  cards = [];
  lastSelection = null;
  pending = null;
  activeId = null;
  deleted = [];
  focusMode = false;
}

async function openReader(file: OpenDoc): Promise<void> {
  closeReader();
  home = null;
  highlights = await db.highlightsFor(file.rec.hash);
  marks = await db.marksFor(file.rec.hash);
  cards = await db.cardsFor(file.rec.hash);
  const savedOcr = (await db.getMeta<Record<string, OcrPage>>(`ocr:${file.rec.hash}`)) ?? {};
  ocrPages = new Map(Object.entries(savedOcr).map(([k, v]) => [Number(k), v]));
  const savedHw = (await db.getMeta<Record<string, OcrPage & { sig: string }>>(`hw:${file.rec.hash}`)) ?? {};
  hwPages = new Map(Object.entries(savedHw).map(([k, v]) => [Number(k), v]));
  indexHighlights();
  indexMarks();
  rightTab = "marks";
  railOpen = settings.railOpen && !isNarrow();
  panelOpen = settings.panelOpen && !isNarrow();

  const ghost = (label: string | Node, attrs: Record<string, string | EventListener> = {}, ...rest: Node[]) =>
    h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", ...attrs }, label, ...rest);

  const railBtn = ghost("Sayfalar", { class: "cm-btn cm-btn--ghost cm-btn--sm is-desk", title: "Sayfa şeridi ( [ )", "aria-pressed": String(railOpen), onclick: () => toggleRail() });
  const fileBtn = h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-bar__file", title: file.rec.name, "aria-haspopup": "menu", text: file.rec.name });
  const fileMenu = (anchor: HTMLElement, mobile = false) => openMenu(anchor, [
    ...(mobile ? [
      { label: "Dışa aktar", run: () => exportDialog() },
      { label: "Tekrar et", shortcut: "Alt T", run: () => openReview() },
      { label: resolvedTheme() === "dark" ? "Açık tema" : "Koyu tema", run: () => void changeSettings({ ...settings, theme: resolvedTheme() === "dark" ? "light" : "dark" }) },
      { label: "Sayfaya yer imi", shortcut: "B", run: () => toggleBookmark() },
      "sep" as const,
    ] : []),
    { label: "Bu sayfaya not ekle", shortcut: "Shift N", run: () => addPageNote() },
    { label: "Metni tanıt (OCR): bu sayfa", run: () => void runOcr("page") },
    { label: "El yazısını tanı (aranabilir yap)", run: () => void runHandwriting(false) },
    { label: "Metni tanıt (OCR): tüm sayfalar", run: () => void runOcr("all") },
    "sep",
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
  const panelBtn = ghost("İşaretler ", { title: "İşaretler paneli ( ] )", "aria-pressed": String(panelOpen), onclick: () => {
    if (panelOpen && rightTab !== "marks") showRightTab("marks");
    else togglePanel();
  } }, h("span", { class: "cm-num", text: num(highlights.length) }));
  // Dışa aktar menüsü: Markdown notları, vurgulu PDF ve Tekrar modu girişi.
  const exportBtn = h("button", { class: "cm-btn cm-btn--sm", "aria-haspopup": "menu" }, "Dışa aktar");
  exportBtn.addEventListener("click", () => openMenu(exportBtn, [
    { label: "Markdown notları…", hint: ".md", run: () => exportDialog("md") },
    { label: "Vurgulu PDF…", hint: ".pdf", run: () => exportDialog("pdf") },
    "sep",
    { label: "Tekrar et", shortcut: "Alt T", run: () => openReview() },
  ], "right"));
  const aiBtn = ghost("AI", { title: "AI paneli (Ctrl J)", "aria-pressed": "false", onclick: () => toggleAi() });
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
      exportBtn,
      sep(),
      panelBtn,
      aiBtn,
    ),
  );

  const stage = h("div", { class: "cm-stage", tabindex: "0", "aria-label": "Belge" });
  const pageFlag = h("div", { class: "cm-pageflag cm-num", "aria-hidden": "true" });
  const stageWrap = h("main", { class: "cm-stagewrap", "aria-label": file.rec.name }, stage, pageFlag);
  const band = h("div", { class: "cm-band" });

  const float = new FloatBar({
    color: (c) => applyColor(c),
    note: () => noteFromFloat(),
    copy: () => copySelection(),
    remove: () => activeId && removeHighlight(activeId),
    ask: () => askSelection(),
  });

  const viewer = new Viewer(stage, file.doc, {
    pageChange: (i) => onPageChange(i),
    selection: (parts) => {
      if (reader?.mode === "write" && reader.write.tool !== "highlight") return;
      onSelection(parts);
    },
    selectionCleared: () => {
      pending = null;
      if (float.mode === "new" || float.mode === "applied") float.hide();
      activeId = null;
    },
    highlightClick: (id) => {
      if (reader?.mode === "write" && reader.write.tool !== "highlight") return;
      onHighlightClick(id);
    },
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
    jumpMark: (m) => {
      viewer.reveal(m.page, markBox(m));
      if (isNarrow()) togglePanel(false);
    },
    editMark: (m) => {
      void setMode("write").then(() => {
        reader?.write.setTool("select");
        viewer.reveal(m.page, markBox(m));
        setTimeout(() => reader?.write.edit(m.id), 280);
      });
    },
    removeMark: (id) => removeMarkWithUndo(id),
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
      const all = await viewer.findAllRects(m.page, q);
      viewer.showSearchHits(m.page, all, m.occurrence);
      const rects = all[m.occurrence];
      if (rects?.[0]) viewer.reveal(m.page, rects[0]);
    },
    close: () => stage.focus({ preventScroll: true }),
  }, (i) => textOf(i));
  stageWrap.append(search.el);

  const write = new WriteMode(viewer, file.rec.hash, settings.pen, {
    marks: () => marks,
    add: addMark,
    update: updateMark,
    remove: removeMark,
    redraw: drawMarks,
    pen: (pen) => void changeSettings({ ...settings, pen }),
    handwriting: (list, page, mode) => handwritingDialog(list, page, mode),
    announce,
  });
  write.el.hidden = true;
  stageWrap.append(write.el);

  const ai = new AiPanel({
    settings: () => settings.ai,
    context: (scope) => aiContext(scope),
    counts: () => ({ selection: !!lastSelection, hl2: highlights.filter((x) => x.color === 2).length, hl4: highlights.filter((x) => x.color === 4).length }),
    citeHover: (c) => void showCite(c),
    citeJump: (c) => void jumpCite(c),
    addNote: (page, text) => addAiNote(page, text),
    openSettings: aiSetup,
    loadHistory: async () => (await db.getMeta<SavedTurn[]>(`ai:${file.rec.hash}`)) ?? [],
    saveHistory: (turns) => void db.putMeta(`ai:${file.rec.hash}`, turns),
    exportChat: (turns) => download(`${file.rec.name.replace(/\.pdf$/i, "")}-ai-sohbet.md`, chatMarkdown(file.title, turns, dateLong), "text/markdown;charset=utf-8"),
    highlightCites: (cites, color) => highlightCites(cites, color),
    suggestCards: (text) => suggestCards(text),
    colorName: (c) => settings.names[c],
  });
  ai.el.hidden = true;
  const tab = (id: "marks" | "ai", label: string) =>
    h("button", { class: `cm-tab${id === "marks" ? " is-on" : ""}`, role: "tab", "data-tab": id, "aria-selected": String(id === "marks"), onclick: () => showRightTab(id) }, label);
  const rtabs = h("div", { class: "cm-tabs cm-rtabs", role: "tablist", hidden: true }, tab("marks", "İşaretler"), tab("ai", "AI"));
  const right = h("div", { class: "cm-right" }, rtabs, panel.el, ai.el);

  const body = h("div", { class: "cm-body" }, rail.el, stageWrap, right);
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
    write, ai, aiBtn, rtabs, outline: [], mode: "read",
  };
  renderModeSeg("read");
  applySettings();
  updateLayout();
  bindFocusPeek(root);

  viewer.ocrFor = (p) => ocrPages.get(p) ?? null;
  viewer.hwFor = (p) => hwPages.get(p) ?? null;
  await viewer.init((p) => byPage.get(p) ?? [], file.rec.lastPage);
  if (file.rec.scrollMode && file.rec.scrollMode !== viewer.scrollMode) viewer.setScrollMode(file.rec.scrollMode);
  updateZoomLabel();
  onPageChange(viewer.current);
  refreshHighlights();
  refreshMarks();
  applyHandwriting();
  rail.setBookmarks(file.rec.bookmarks);
  stage.focus({ preventScroll: true });
  if (file.rec.lastPage > 0) toast(`Kaldığın yerden: sayfa ${num(file.rec.lastPage + 1)}`);

  void loadOutline(file.doc).then((o) => {
    if (reader?.file !== file) return;
    reader.outline = o;
    rail.setOutline(o);
  }).catch(() => {});
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
  if (rightTab === "ai" && aiOn()) reader.ai.pageChanged();
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

/** Sayfanın metni: PDF'in kendi metni, yoksa OCR ile tanınan metin. */
async function textOf(i: number): Promise<string> {
  if (!reader) return "";
  const own = await pageText(reader.file.doc, i);
  const hw = hwPages.get(i)?.text;
  const base = own.trim() ? own : ocrPages.get(i)?.text ?? "";
  return hw ? `${base}\n${hw}` : base;
}

/**
 * Tarayıcıda OCR: metni olmayan sayfalar bu cihazda tanınır (Türkçe + İngilizce).
 * İlerleme şeritte; Durdur'a basınca o ana kadarki sayfalar kalır.
 */
async function runOcr(scope: "page" | "all"): Promise<void> {
  if (!reader || ocrRun) return;
  const r = reader;
  const doc = r.file.doc;
  const run = { stop: false };
  ocrRun = run;
  const pages: number[] = [];
  const candidates = scope === "page" ? [r.viewer.current] : [...Array(doc.numPages).keys()];
  for (const i of candidates) {
    if (ocrPages.has(i)) continue;
    if ((await pageText(doc, i)).trim()) continue;
    pages.push(i);
  }
  if (!pages.length) {
    ocrRun = null;
    toast(scope === "page" ? "Bu sayfanın metni zaten seçilebilir." : "Tanınacak sayfa yok: bütün sayfaların metni var.");
    return;
  }
  const title = h("p", { class: "cm-notice__title", text: "Metin tanınıyor (OCR)…" });
  const detail = h("p", { class: "cm-notice__text", text: "İlk kullanımda tanıma verisi (~5 MB) indirilir. Sayfalar bu cihazda okunur, hiçbir yere gönderilmez." });
  const fill = h("div", {});
  const bar = h("div", { class: "cm-drop__progress", role: "progressbar", "aria-label": "OCR ilerlemesi", "aria-valuemin": "0", "aria-valuemax": String(pages.length), "aria-valuenow": "0", style: "margin:8px 0" }, fill);
  r.band.replaceChildren(
    h("div", { class: "cm-notice", role: "status" },
      h("span", { class: "cm-notice__sym", "aria-hidden": "true", text: "…" }),
      h("div", {}, title, detail, bar,
        h("div", { style: "display:flex;gap:8px" },
          h("button", { class: "cm-btn cm-btn--sm", onclick: () => { run.stop = true; void stopOcr(); } }, "Durdur"),
        ),
      ),
    ),
  );
  let done = 0;
  let failed = false;
  for (const i of pages) {
    if (run.stop || reader !== r) break;
    title.textContent = `Metin tanınıyor: sayfa ${num(i + 1)} (${num(done + 1)}/${num(pages.length)})`;
    try {
      const page = await recognizePage(doc, i, (status, ratio) => {
        if (status.startsWith("loading")) detail.textContent = `Tanıma verisi yükleniyor… %${Math.round(ratio * 100)}`;
        else if (status.startsWith("recognizing")) detail.textContent = `Sayfa okunuyor… %${Math.round(ratio * 100)}`;
      });
      if (run.stop || reader !== r) break;
      ocrPages.set(i, page);
      r.viewer.refreshText(i);
      done++;
      bar.setAttribute("aria-valuenow", String(done));
      fill.style.width = `${(done / pages.length) * 100}%`;
      await db.putMeta(`ocr:${r.file.rec.hash}`, Object.fromEntries(ocrPages));
    } catch (err) {
      if (!run.stop) {
        failed = true;
        console.error(err);
      }
      break;
    }
  }
  ocrRun = null;
  if (reader !== r) return;
  r.search.invalidate();
  r.band.replaceChildren();
  if (failed) toast("OCR çalıştırılamadı. Sayfayı yenileyip tekrar dene.");
  else toast(`${num(done)} sayfanın metni tanındı${run.stop ? " (durduruldu)" : ""}. Artık vurgulayabilir, arayabilir ve AI'ya sorabilirsin.`);
  if (done) {
    r.file.rec.scannedDismissed = true;
    void db.putFile(r.file.rec);
  }
}

// ---------- El yazısı ----------

/** Sayfanın ölçek 1'deki boyutu (çizimler bu oranda çizilir). */
function pageSize(page: number): [number, number] {
  const el = reader?.viewer.pageElement(page);
  const s = reader?.viewer.scale ?? 1;
  return el ? [el.clientWidth / s, el.clientHeight / s] : [595, 842];
}

const inkOf = (page: number) => (marksByPage.get(page) ?? []).filter((m) => m.kind === "ink" || m.kind === "shape");
const inkSig = (list: Mark[]) => `${list.length}:${Math.max(0, ...list.map((m) => m.updatedAt))}`;

/** Kement eylem çubuğundan: seçili el yazısını metne çevir ya da matematiği çöz. */
function handwritingDialog(list: Mark[], page: number, mode: "text" | "math"): void {
  if (!reader) return;
  const r = reader;
  const box = unionBox(list)!;
  const [pw, ph] = pageSize(page);
  const color = (list.find((m) => m.kind === "ink") as Extract<Mark, { kind: "ink" }> | undefined)?.color ?? "black";
  openHandwriting({
    mode,
    canvas: rasterInk(list, pw, ph, box),
    ai: settings.ai,
    ocr: async (canvas, onProgress) => (await recognizeCanvas(canvas, (st, ratio) => onProgress(st.startsWith("loading") ? `Tanıma verisi yükleniyor… %${Math.round(ratio * 100)}` : `Okunuyor… %${Math.round(ratio * 100)}`))).text,
    insertText: (text, remove) => {
      const now = Date.now();
      const m: Mark = { id: uid(), fileHash: r.file.rec.hash, page, kind: "text", color, box: [box[0], box[1], Math.min(1 - box[0], Math.max(box[2], 0.25)), box[3]], text, createdAt: now, updatedAt: now };
      if (r.mode === "write") r.write.replace([m], remove ? list : []);
      else addMark(m);
      announce("Metin kutusu eklendi");
    },
    insertNote: (text) => {
      const now = Date.now();
      const x = Math.min(0.72, box[0] + box[2] + 0.02);
      const m: Mark = { id: uid(), fileHash: r.file.rec.hash, page, kind: "sticky", ai: true, box: [x, box[1], 0.27, 0.12], text, createdAt: now, updatedAt: now };
      if (r.mode === "write") r.write.replace([m], []);
      else addMark(m);
      announce("Çözüm not olarak eklendi");
    },
    openAiSettings: aiSetup,
    copy: (t) => void navigator.clipboard?.writeText(t).then(() => toast("Kopyalandı"), () => toast("Panoya kopyalanamadı.")),
  });
}

function applyHandwriting(): void {
  if (!reader) return;
  reader.panel.setHandwriting(new Map([...hwPages].map(([p, v]) => [p, v.text])));
}

/**
 * El yazısını tanı (bu cihazda): kalem çizgisi olan sayfalar tanınır, sonuç sayfanın metin katmanına
 * eklenir; Ctrl F, panel araması ve AI kapsamı el yazısını da görür. `quiet`: Yaz modundan çıkınca
 * yalnızca değişen sayfalar, şeritsiz.
 */
async function runHandwriting(quiet: boolean): Promise<void> {
  if (!reader || hwRun) return;
  const r = reader;
  const pages = [...marksByPage.keys()].filter((p) => inkOf(p).some((m) => m.kind === "ink") && hwPages.get(p)?.sig !== inkSig(inkOf(p))).sort((a, b) => a - b);
  // Çizimi silinen sayfaların eski sonucu da kalkar.
  for (const p of [...hwPages.keys()]) if (!inkOf(p).some((m) => m.kind === "ink")) hwPages.delete(p);
  if (!pages.length) {
    if (!quiet) toast(hwPages.size ? "El yazısı güncel; aranabilir." : "Tanınacak el yazısı yok. Önce Yaz modunda kalemle yaz.");
    applyHandwriting();
    return;
  }
  const run = { stop: false };
  hwRun = run;
  const title = h("p", { class: "cm-notice__title", text: "El yazısı tanınıyor…" });
  if (!quiet) {
    r.band.replaceChildren(
      h("div", { class: "cm-notice", role: "status" },
        h("span", { class: "cm-notice__sym", "aria-hidden": "true", text: "…" }),
        h("div", {}, title,
          h("p", { class: "cm-notice__text", text: "Bu cihazda tanınır, hiçbir yere gönderilmez. Düzgün, ayrık yazıda iyi sonuç verir." }),
          h("div", { style: "display:flex;gap:8px" }, h("button", { class: "cm-btn cm-btn--sm", onclick: () => { run.stop = true; } }, "Durdur")),
        ),
      ),
    );
  }
  let done = 0;
  try {
    for (const p of pages) {
      if (run.stop || reader !== r) break;
      title.textContent = `El yazısı tanınıyor: sayfa ${num(p + 1)} (${num(done + 1)}/${num(pages.length)})`;
      const list = inkOf(p);
      const [pw, ph] = pageSize(p);
      const res = await recognizeCanvas(rasterInk(list, pw, ph, null, 2200));
      if (reader !== r) break;
      if (res.text.trim()) hwPages.set(p, { ...res, sig: inkSig(list) });
      else hwPages.delete(p);
      r.viewer.refreshText(p);
      done++;
    }
  } catch (err) {
    console.error(err);
    if (!quiet) toast("El yazısı tanınamadı. Sayfayı yenileyip tekrar dene.");
  }
  hwRun = null;
  if (reader !== r) return;
  await db.putMeta(`hw:${r.file.rec.hash}`, Object.fromEntries(hwPages));
  r.search.invalidate();
  applyHandwriting();
  if (!quiet) {
    r.band.replaceChildren();
    toast(`${num(done)} sayfanın el yazısı tanındı. Artık Ctrl F ile aranabilir.`);
  }
}

function showScannedBand(): void {
  if (!reader) return;
  const r = reader;
  r.band.replaceChildren(
    h("div", { class: "cm-notice cm-notice--warn", role: "status" },
      h("span", { class: "cm-notice__sym", "aria-hidden": "true", text: "!" }),
      h("div", {},
        h("p", { class: "cm-notice__title", text: "Bu dosyada seçilebilir metin yok" }),
        h("p", { class: "cm-notice__text", text: "Taranmış bir belge gibi görünüyor. Okuyabilir, sayfa notu ve Yaz modu işaretleri ekleyebilirsin; metin vurgulama ve arama için metni tanıt (OCR)." }),
        h("div", { style: "display:flex;gap:8px" },
          h("button", { class: "cm-btn cm-btn--sm", onclick: () => void runOcr("all") }, "Metni tanıt (OCR)"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => addPageNote() }, "Sayfaya not ekle"),
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

function renderModeSeg(mode: Mode): void {
  if (!reader) return;
  const btn = (m: Mode, label: string, key: string) =>
    h("button", { class: mode === m ? "is-on" : "", "aria-pressed": String(mode === m), title: `${label} (${key})`, onclick: () => void setMode(m) }, label);
  reader.modeSeg.replaceChildren(btn("read", "Oku", "Alt 1"), btn("write", "Yaz", "Alt 2"), btn("edit", "Düzenle", "Alt 3"));
}

/** Mod değişince yalnızca araçlar değişir; sayfa, zoom ve konum aynı kalır. */
async function setMode(mode: Mode): Promise<void> {
  if (!reader || reader.mode === mode) return;
  const r = reader;
  // Düzenle modundan çıkış: kaydedilmemiş değişiklik varsa sor.
  if (r.editor) {
    if (r.editor.changes) {
      const ok = await confirmDialog({
        title: "Kaydedilmemiş değişiklikler var",
        text: `${num(r.editor.changes)} sayfa değişikliği kaydedilmedi. Düzenle modundan çıkarsan kaybolur.`,
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
    r.viewer.scheduleRender(0);
  }
  if (r.mode === "write") {
    r.write.disable();
    r.write.el.hidden = true;
    r.root.classList.remove("is-write");
    // El yazısı bir kez aranabilir yapıldıysa değişen sayfalar arka planda yeniden tanınır.
    if (hwPages.size) void runHandwriting(true);
  }
  r.mode = mode;
  renderModeSeg(mode);
  hideFloat();
  if (mode === "edit") {
    r.search.el.hidden = true;
    const editor = new PageEditor(
      { id: "main", name: r.file.rec.name, bytes: r.file.bytes, doc: r.file.doc },
      { saved: (out, name, pages, hashes) => void onEditorSaved(out, name, pages, hashes), askPassword: (n, w) => askPassword(n, w) },
      r.outline,
    );
    r.editor = editor;
    r.body.hidden = true;
    r.root.classList.add("is-edit");
    r.root.insertBefore(editor.el, r.body.nextSibling);
    editor.focus();
    return;
  }
  if (mode === "write") {
    if (focusMode) setFocus(false);
    window.getSelection()?.removeAllRanges();
    r.root.classList.add("is-write");
    r.write.el.hidden = false;
    r.write.enable();
    announce("Yaz modu");
  } else {
    announce("Oku modu");
  }
  r.stage.focus({ preventScroll: true });
}

/** Düzenle modunda kaydedilen kopya: vurgular ve yer imleri sayfalarıyla birlikte yeni dosyaya taşınır. */
async function onEditorSaved(out: Uint8Array, name: string, pages: EditPage[], sourceHashes: Map<string, string>): Promise<void> {
  if (!reader) return;
  const hash = await sha256(out.slice().buffer as ArrayBuffer);
  const moved: Highlight[] = [];
  const movedMarks: Mark[] = [];
  const newHlIds = new Map<string, string>();
  const bookmarks: number[] = [];
  // Birleştirilen PDF'ler daha önce açılıp vurgulandıysa onların işaretleri de taşınır.
  const other = new Map<string, { hl: Highlight[]; marks: Mark[] }>();
  for (const [id, h] of sourceHashes) other.set(id, { hl: await db.highlightsFor(h), marks: await db.marksFor(h) });
  pages.forEach((p, newIndex) => {
    if (p.src && p.src !== "main") {
      const src = other.get(p.src);
      for (const hl of src?.hl.filter((x) => x.page === p.index) ?? []) {
        const rects = hl.rects.map((r) => editRect(r, p)).filter((r): r is Rect => !!r);
        if (rects.length) moved.push({ ...hl, id: uid(), fileHash: hash, page: newIndex, rects, updatedAt: Date.now() });
      }
      for (const m of src?.marks.filter((x) => x.page === p.index) ?? []) {
        const em = editMark(m, p);
        if (em) movedMarks.push({ ...em, id: uid(), fileHash: hash, page: newIndex, updatedAt: Date.now() });
      }
      return;
    }
    if (p.src !== "main") return;
    // Döndürme, kırpma ve not alanı: vurgu ve işaretler yeni sayfadaki yerlerine; kırpılan alandakiler düşer.
    for (const hl of byPage.get(p.index) ?? []) {
      const rects = hl.rects.map((r) => editRect(r, p)).filter((r): r is Rect => !!r);
      if (!rects.length) continue;
      const id = uid();
      if (!newHlIds.has(hl.id)) newHlIds.set(hl.id, id);
      moved.push({ ...hl, id, fileHash: hash, page: newIndex, rects, updatedAt: Date.now() });
    }
    for (const m of marksByPage.get(p.index) ?? []) {
      const em = editMark(m, p);
      if (em) movedMarks.push({ ...em, id: uid(), fileHash: hash, page: newIndex, updatedAt: Date.now() });
    }
    if (reader!.file.rec.bookmarks.includes(p.index)) bookmarks.push(newIndex);
  });
  // Tekrar kartları da sayfalarıyla taşınır (vurgu kartları yeni vurguya bağlanır).
  const movedCards: Card[] = [];
  pages.forEach((p, newIndex) => {
    if (p.src !== "main") return;
    for (const c of cards.filter((x) => x.page === p.index && x.status === "active")) {
      const hlId = c.highlightId ? newHlIds.get(c.highlightId) : undefined;
      if (c.highlightId && !hlId) continue;
      movedCards.push({ ...c, id: hlId ? `hl-${hlId}` : uid(), fileHash: hash, page: newIndex, highlightId: hlId, updatedAt: Date.now() });
    }
  });
  await db.putHighlights(moved);
  await db.putMarks(movedMarks);
  await db.putCards(movedCards);
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
  lastSelection = parts;
  activeId = null;
  showFloatFor(parts[0].page, parts[0].rects, "new");
  if (rightTab === "ai" && aiOn()) reader.ai.selectionChanged();
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
    mode, settings.names, color, reader.stage.getBoundingClientRect().top, aiOn(),
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

/** Bellekteki durum hemen güncellenir; veritabanı yazımı beklenmez (ardından gelen N/C tuşu kaybolmasın). */
function createFromPending(color: Color): Highlight[] {
  if (!pending || !reader) return [];
  const now = Date.now();
  // Birden fazla sayfaya yayılan seçim: parçalar tek vurgu gibi davranır (aynı grup).
  const group = pending.length > 1 ? uid() : undefined;
  const created = pending.map<Highlight>((p) => ({
    id: uid(), fileHash: reader!.file.rec.hash, page: p.page, color, rects: p.rects, text: p.text, note: "", createdAt: now, updatedAt: now,
    ...(group ? { group } : {}),
  }));
  highlights.push(...created);
  pending = null;
  window.getSelection()?.removeAllRanges();
  lastColor = color;
  reader.panel.markNew(created[0].id);
  refreshHighlights(created.map((c) => c.page));
  announce(`${settings.names[color]} olarak vurgulandı, sayfa ${created[0].page + 1}`);
  void db.putHighlights(created);
  if (!persistAsked) {
    persistAsked = true;
    void db.requestPersistence();
  }
  return created;
}

async function applyColor(color: Color): Promise<void> {
  if (!reader) return;
  if (pending) {
    const [hl] = createFromPending(color);
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
  const parts = groupOf(hl);
  for (const p of parts) {
    p.color = color;
    p.updatedAt = Date.now();
  }
  lastColor = color;
  refreshHighlights(parts.map((p) => p.page));
  showFloatFor(hl.page, hl.rects, "applied", color);
  announce(`${settings.names[color]} olarak değiştirildi`);
  await db.putHighlights(parts);
}

async function noteFromFloat(): Promise<void> {
  if (!reader) return;
  let id = activeId;
  if (pending) id = createFromPending(lastColor)[0]?.id ?? null;
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

/** Bir vurgunun bütün parçaları (sayfalar arası seçimde birden fazla). */
function groupOf(hl: Highlight): Highlight[] {
  return hl.group ? highlights.filter((x) => x.group === hl.group) : [hl];
}

function removeHighlight(id: string): void {
  const hl = highlights.find((x) => x.id === id);
  if (!hl || !reader) return;
  const parts = groupOf(hl);
  const ids = new Set(parts.map((p) => p.id));
  highlights = highlights.filter((x) => !ids.has(x.id));
  deleted.push(parts);
  hideFloat();
  refreshHighlights(parts.map((p) => p.page));
  parts.forEach((p) => void db.deleteHighlight(p.id));
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

function exportDialog(initial: "md" | "pdf" = "md"): void {
  if (!reader) return;
  if (!highlights.length && !marks.some((m) => (m.kind === "text" || m.kind === "sticky") && m.text.trim())) {
    toast("Dışa aktaracak vurgu ya da not yok. Önce sayfada metni seçip vurgula.");
    return;
  }
  const r = reader;
  openExport({
    title: r.file.title, fileName: r.file.rec.name, highlights, marks, names: settings.names, pageCount: r.viewer.pageCount, initial,
    pdf: async (choice) => {
      const { exportAnnotatedPdf } = await import("./export/pdf"); // pdf-lib yalnızca burada yüklenir
      const out = await exportAnnotatedPdf(r.file.bytes, highlights, marks, { ...choice, names: settings.names });
      download(`${r.file.rec.name.replace(/\.pdf$/i, "")}-isaretli.pdf`, out, "application/pdf");
      toast("İşaretli PDF indirildi");
    },
  });
}

/** Sayfa notu: metne bağlı olmayan, doğrudan sayfaya yazılan not (taranmış sayfalarda asıl işe yarar). */
function addPageNote(page = reader?.viewer.current ?? 0): void {
  if (!reader) return;
  const now = Date.now();
  const existing = (marksByPage.get(page) ?? []).filter((m) => m.kind === "sticky" && m.pageNote).length;
  const m: Mark = { id: uid(), fileHash: reader.file.rec.hash, page, kind: "sticky", pageNote: true, box: [0.62, Math.min(0.85, 0.03 + existing * 0.12), 0.34, 0.08], text: "", createdAt: now, updatedAt: now };
  addMark(m);
  reader.viewer.reveal(page, m.box);
  requestAnimationFrame(() => reader?.write.edit(m.id, true));
}

// ---------- AI ----------

const MAX_PAGES = 40;
const MAX_CHARS = 150_000;

/** Seçim araç çubuğundaki Sor: seçili metni kapsam yaparak AI panelini açar. */
function askSelection(): void {
  if (!reader || !aiOn()) return;
  if (pending) lastSelection = pending;
  hideFloat();
  if (!panelOpen) togglePanel(true);
  if (focusMode) setFocus(false);
  showRightTab("ai");
  reader.ai.askAboutSelection();
}

/** Okunan sayfanın içinde bulunduğu bölüm: içindekiler ağacında bir sonraki başlığa kadar. */
function sectionRange(outline: OutlineItem[], page: number): [number, number] | null {
  const flat: number[] = [];
  const walk = (items: OutlineItem[]) => items.forEach((it) => (it.page !== null && flat.push(it.page), walk(it.children)));
  walk(outline);
  const starts = [...new Set(flat)].sort((a, b) => a - b);
  const start = starts.filter((p) => p <= page).at(-1);
  if (start === undefined) return null;
  const next = starts.find((p) => p > start);
  return [start, (next ?? reader!.viewer.pageCount) - 1];
}

/** Kapsamın metni. Dosyanın tamamı asla kendiliğinden gönderilmez; uzun kapsam kırpılmaz, söylenir. */
async function aiContext(scope: Scope): Promise<AiContext | { error: string }> {
  if (!reader) return { error: "Açık dosya yok." };
  const cur = reader.viewer.current;
  const hlPages = (list: Highlight[], label: string): AiContext | { error: string } => {
    if (!list.length) return { error: "Bu kapsamda vurgu yok." };
    const pages = new Map<number, string[]>();
    for (const x of [...list].sort(readingOrder)) {
      const line = `- [${settings.names[x.color]}] ${x.text}${x.note.trim() ? ` (Notum: ${x.note.trim()})` : ""}`;
      pages.set(x.page, [...(pages.get(x.page) ?? []), line]);
    }
    return { label, pages: [...pages].map(([page, lines]) => ({ page, text: lines.join("\n") })) };
  };
  switch (scope) {
    case "selection": {
      if (!lastSelection?.length) return { error: "Önce sayfada metin seç, sonra Sor'a bas ya da A." };
      const pages = lastSelection.map((p) => ({ page: p.page, text: p.text }));
      return { label: `seçim (s. ${pages.map((p) => p.page + 1).join(", ")})`, pages };
    }
    case "page": {
      const text = await textOf(cur);
      if (!text.trim()) return { error: "Bu sayfada seçilebilir metin yok (taranmış olabilir). Dosya menüsünden Metni tanıt (OCR) ile metni çıkar." };
      return { label: `sayfa ${num(cur + 1)} metni`, pages: [{ page: cur, text }] };
    }
    case "section": {
      const range = sectionRange(reader.outline, cur);
      if (!range) return { error: "Bu PDF'in içindekiler bilgisi yok; bölüm bulunamadı. Bu sayfa ya da Seçim kapsamını kullan." };
      const [a, b] = range;
      if (b - a + 1 > MAX_PAGES) return { error: `Bu bölüm ${num(b - a + 1)} sayfa; en fazla ${MAX_PAGES} sayfa gönderilebilir. Bu sayfa ya da Seçim kapsamını kullan.` };
      const pages: AiContext["pages"] = [];
      let chars = 0;
      for (let i = a; i <= b; i++) {
        const text = await textOf(i);
        chars += text.length;
        if (chars > MAX_CHARS) return { error: `Bu bölüm çok uzun (${num(chars)}+ karakter). Bu sayfa ya da Seçim kapsamını kullan.` };
        if (text.trim()) pages.push({ page: i, text });
      }
      if (!pages.length) return { error: "Bu bölümde seçilebilir metin yok." };
      return { label: `bölüm, s. ${num(a + 1)}–${num(b + 1)}`, pages };
    }
    case "highlights":
      return hlPages(highlights, `${num(highlights.length)} vurgu`);
    case "hl2": {
      const list = highlights.filter((x) => x.color === 2);
      return hlPages(list, `${num(list.length)} "${settings.names[2]}" vurgusu`);
    }
    case "hl4": {
      const list = highlights.filter((x) => x.color === 4);
      return hlPages(list, `${num(list.length)} "${settings.names[4]}" vurgusu`);
    }
    case "hl24": {
      const list = highlights.filter((x) => x.color === 2 || x.color === 4);
      return hlPages(list, `${num(list.length)} "${settings.names[2]}" ve "${settings.names[4]}" vurgusu`);
    }
  }
}

/** Kaynak etiketinin üstüne gelince sayfadaki dayanak metin noktalı alt çizgiyle gösterilir. */
async function showCite(c: Cite | null): Promise<void> {
  if (!reader) return;
  if (!c || !c.quote) {
    reader.viewer.showSearchHit(null, []);
    return;
  }
  if (c.page < 0 || c.page >= reader.viewer.pageCount) return;
  const rects = await reader.viewer.findRects(c.page, c.quote, 0);
  reader.viewer.showSearchHit(rects.length ? c.page : null, rects, "cite");
}

/** Kaynak etiketine tıklamak, panelden vurguya atlamayla aynı davranır. */
async function jumpCite(c: Cite): Promise<void> {
  if (!reader || c.page < 0 || c.page >= reader.viewer.pageCount) return;
  const rects = c.quote ? await reader.viewer.findRects(c.page, c.quote, 0) : [];
  reader.viewer.reveal(c.page, rects[0]);
  if (rects.length) {
    reader.viewer.showSearchHit(c.page, rects, "cite");
    setTimeout(() => reader?.viewer.showSearchHit(null, []), 1800);
  } else if (c.quote) {
    toast(`Alıntı sayfa ${num(c.page + 1)}'de birebir bulunamadı; kaynağı kendin kontrol et.`, undefined, 4000);
  }
}

// ---------- Tekrar modu ----------

/** Tam ekran tekrar: araç çubuğu tek satır; sayfa, zoom ve konum değişmez, çıkınca okumaya dönülür. */
function openReview(): void {
  if (!reader || review || reader.editor) return;
  const r = reader;
  hideFloat();
  if (focusMode) setFocus(false);
  const screen = new ReviewScreen(r.file.title, settings.names, cards, highlights, {
    save: (list) => {
      for (const c of list) if (!cards.includes(c)) cards.push(c);
      void db.putCards(list);
    },
    remove: (id) => {
      cards = cards.filter((c) => c.id !== id);
      void db.deleteCard(id);
    },
    source: (c) => {
      closeReview();
      const hl = c.highlightId ? highlights.find((x) => x.id === c.highlightId) : undefined;
      r.viewer.reveal(c.page, hl?.rects[0], hl?.id);
    },
    exit: () => closeReview(),
  });
  review = screen;
  r.root.classList.add("is-review");
  r.body.hidden = true;
  r.root.insertBefore(screen.el, r.body.nextSibling);
  screen.focus();
  announce("Tekrar modu");
}

function closeReview(): void {
  if (!review || !reader) return;
  review.el.remove();
  review = null;
  reader.root.classList.remove("is-review");
  reader.body.hidden = false;
  reader.viewer.scheduleRender(0);
  reader.stage.focus({ preventScroll: true });
}

/** AI'nın kart önerileri "önerilen" olarak saklanır; Tekrar modunda onaylanmadan desteye girmez. */
function suggestCards(text: string): number {
  if (!reader) return 0;
  const now = Date.now();
  const found = parseSuggestions(text);
  const list: Card[] = found.map((s) => ({
    id: uid(), fileHash: reader!.file.rec.hash, page: Math.min(Math.max(0, s.page ?? reader!.viewer.current), reader!.viewer.pageCount - 1),
    source: "ai", front: s.front, back: s.back, status: "suggested", ...freshSchedule(now), createdAt: now, updatedAt: now,
  }));
  if (!list.length) return 0;
  cards.push(...list);
  void db.putCards(list);
  toast(`${num(list.length)} kart önerisi Tekrar modunda onayını bekliyor`, { label: "Aç", run: () => openReview() }, 8000);
  return list.length;
}

/** Cevaptaki kaynakların dayanak metnini vurgula (açık bir tıkla, seçilen renkle). */
async function highlightCites(cites: Cite[], color: Color): Promise<number> {
  if (!reader) return 0;
  const now = Date.now();
  const created: Highlight[] = [];
  for (const c of cites) {
    if (c.page < 0 || c.page >= reader.viewer.pageCount || !c.quote) continue;
    const rects = await reader.viewer.findRects(c.page, c.quote, 0);
    if (!rects.length) continue;
    // Aynı yer zaten vurgulanmışsa yinelenmesin.
    if ((byPage.get(c.page) ?? []).some((x) => Math.abs((x.rects[0]?.[1] ?? -1) - rects[0][1]) < 0.003 && Math.abs((x.rects[0]?.[0] ?? -1) - rects[0][0]) < 0.01)) continue;
    created.push({ id: uid(), fileHash: reader.file.rec.hash, page: c.page, color, rects, text: c.quote, note: "", createdAt: now, updatedAt: now });
  }
  if (!created.length) return 0;
  highlights.push(...created);
  refreshHighlights(created.map((x) => x.page));
  await db.putHighlights(created);
  return created.length;
}

/** AI cevabı yalnızca açık bir tıkla, "AI" etiketli yapışkan not olarak eklenir. */
function addAiNote(page: number, text: string): void {
  if (!reader) return;
  page = Math.min(Math.max(0, page), reader.viewer.pageCount - 1);
  const existing = (marksByPage.get(page) ?? []).filter((m) => m.kind === "sticky" && m.ai).length;
  const now = Date.now();
  const m: Mark = { id: uid(), fileHash: reader.file.rec.hash, page, kind: "sticky", ai: true, box: [0.7, Math.min(0.85, 0.06 + existing * 0.12), 0.27, 0.1], text, createdAt: now, updatedAt: now };
  addMark(m);
  toast(`AI notu sayfa ${num(page + 1)}'ye eklendi`, { label: "Geri al", run: () => removeMark(m.id) });
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

  if (e.altKey && !ctrl && /^Digit[123]$/.test(e.code)) {
    e.preventDefault();
    void setMode((["read", "write", "edit"] as const)[Number(e.code.slice(5)) - 1]);
    return;
  }
  if (review) return; // Tekrar modu kendi kısayollarını işler
  if (e.altKey && !ctrl && e.code === "KeyT") {
    e.preventDefault();
    openReview();
    return;
  }
  if (r.editor) {
    if (r.editor.handleKey(e)) e.preventDefault();
    return;
  }
  if (r.mode === "write" && !(r.write.tool === "highlight" && (pending || r.float.mode))) {
    if (r.write.handleKey(e)) return e.preventDefault();
    if (e.key === "Escape" && !isTyping(e)) {
      if (r.write.selectedId) r.write.setTool(r.write.tool);
      else void setMode("read"); // Esc Oku moduna döner; son araç hatırlanır
      return e.preventDefault();
    }
  }
  if (ctrl && key === "j") {
    e.preventDefault();
    toggleAi();
    return;
  }
  if (ctrl) {
    if (key === "f") (e.preventDefault(), r.search.open(window.getSelection()?.toString().trim() || undefined));
    else if (key === "+" || key === "=") (e.preventDefault(), r.viewer.zoomBy(1.1));
    else if (key === "-") (e.preventDefault(), r.viewer.zoomBy(1 / 1.1));
    else if (key === "0") (e.preventDefault(), r.viewer.setZoom("width"));
    else if (key === "z" && !isTyping(e) && deleted.length) (e.preventDefault(), void undoDelete());
    return;
  }
  if (isTyping(e) || e.altKey) return;

  const selecting = !!pending || r.float.mode === "applied";
  if (selecting && /^[1-4]$/.test(e.key)) return e.preventDefault(), void applyColor(Number(e.key) as Color);
  if (selecting && key === "n") return e.preventDefault(), void noteFromFloat();
  if (selecting && key === "c") return e.preventDefault(), copySelection();
  if (selecting && key === "a" && aiOn()) return e.preventDefault(), askSelection();
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
    case "N":
      if (!e.shiftKey) return;
      addPageNote();
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
  installErrorLog();
  settings = await db.loadSettings();
  applySettings();
  registerPwa((files, handles) => {
    const f = files.find((x) => /\.pdf$/i.test(x.name) || x.type === "application/pdf");
    if (f) void openFile(f, handles[files.indexOf(f)] as FsHandle);
  });
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

