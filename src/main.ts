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
import { analyzePage, subtractBoxes, type PageAnalysis } from "./ocr/detect";
import { openHandwriting } from "./ui/handwriting";
import { icon } from "./ui/icons";
import { AudioBar } from "./audio/bar";
import { canLiveTranscribe, canRecord, clock, Recorder } from "./audio/recorder";
import { openTranscript } from "./audio/transcript";
import { askCover, askFolder, askNotebook, askPin, askTags } from "./ui/organize";
import type { Template } from "./editor/templates";
import { checkLock, makeLock } from "./app/lock";
import { rasterInk } from "./write/raster";
import { unionBox } from "./write/geometry";
import { loadPdfjs, looksLikePdf, looksScanned, loadOutline, OpenError, openPdf, pageText, type OutlineItem } from "./pdf/load";
import { Viewer, type SelectionPart } from "./pdf/viewer";
import { PageEditor, type EditPage } from "./editor/pageEditor";
import { chatMarkdown, type AiContext, type Cite, type SavedTurn } from "./ai/prompt";
import type { AiSettings, Card, Color, FileRecord, Highlight, Mark, Rect, Settings, Recording } from "./types";
import { askSimple, friendlyError as aiError, ready as aiReady, visionReady } from "./ai/client";
import { QuizSection } from "./quiz/view";
import { askQuiz, type QuizScope } from "./quiz/dialog";
import { parseQuiz, QTYPES, QUIZ_SYSTEM, quizMarkdown, quizPrompt, type Quiz, type QuizRequest } from "./quiz/quiz";
import { COLORS } from "./types";
import { announce, download, h, isTyping, sha256, uid } from "./util";
import { confirmDialog } from "./ui/dialog";
import { AiPanel, type Scope } from "./ui/ai";
import { askPassword, BIG_BYTES, BIG_PAGES, confirmBigFile, openAiSetup, openExport, openSettings, openShortcuts } from "./ui/dialogs";
import { markBox } from "./write/geometry";
import { renderMarks } from "./write/layer";
import { richPlain, toggleCheck } from "./write/rich";
import { WriteMode } from "./write/writeMode";
import { ReviewScreen } from "./review/review";
import { freshSchedule, parseSuggestions } from "./review/srs";
import { FloatBar } from "./ui/float";
import { Home, type RecentRow } from "./ui/home";
import { openMenu, type MenuItem } from "./ui/menu";
import { Panel } from "./ui/panel";
import { Rail } from "./ui/rail";
import { Search } from "./ui/search";
import { toast } from "./ui/toast";
import { canInstall, install, isInstalled, registerPwa } from "./app/pwa";
import { clearErrors, installErrorLog, readErrors, setErrorLog } from "./app/errors";
import { backupDue, markBackedUp, snoozeBackup } from "./app/backupReminder";
import { copiesUsage, deleteAllCopies, deleteCopy, hasCopy, opfsSupported, readCopy, saveCopy } from "./app/opfs";
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
  recorder: Recorder;
  audio: AudioBar;
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
/** Sayfa çözümlemesi (OCR gerekiyor mu?) — belge başına bellekte. */
let analyzed = new Map<number, Promise<PageAnalysis>>();
/** Otomatik OCR kuyruğu: görüntülenen sayfa ve komşuları. */
let autoQueue: number[] = [];
let autoSeen = new Set<number>();
let autoBusy = false;
let autoTimer = 0;
let autoPill: HTMLElement | null = null;
/** Tanınmış el yazısı (meta `hw:<hash>`): sayfa → kelimeler ve hangi çizimlerden tanındığı. */
let hwPages = new Map<number, OcrPage & { sig: string }>();
let hwRun: { stop: boolean } | null = null;
/** Bu dosyanın ses kayıtları ve sürmekte olan kaydın kimliği. */
let recordings: Recording[] = [];
/** Bu dosyanın AI quizleri (meta `quiz:<hash>`) ve son sayfanın altındaki bölüm. */
let quizzes: Quiz[] = [];
let quizView: QuizSection | null = null;
let lastQuiz: QuizRequest | undefined;
let recId: string | null = null;
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
    const dark = resolvedTheme() === "dark";
    reader.themeBtn.replaceChildren(icon(dark ? "sun" : "moon"));
    reader.themeBtn.setAttribute("aria-label", dark ? "Açık tema" : "Koyu tema");
    reader.themeBtn.title = dark ? "Açık tema" : "Koyu tema";
    reader.panel.setData(highlights, settings.names, marks);
    updateAiUi();
    quizView?.render(quizzes);
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
    ...("showDirectoryPicker" in window ? {
      backupFolder: {
        label: async () => (await backupDir())?.name ?? "",
        choose: async () => {
          try {
            const dir = await (window as unknown as { showDirectoryPicker(o: unknown): Promise<DirHandle> }).showDirectoryPicker({ mode: "readwrite", id: "yedek" });
            await db.putMeta("backupDir", dir);
            await autoBackup();
            toast(`Yedek ${dir.name} klasörüne yazıldı; değişikliklerden sonra kendiliğinden güncellenir.`);
          } catch {
            /* vazgeçti */
          }
        },
        clear: async () => {
          await db.putMeta("backupDir", null);
          toast("Otomatik yedek kapatıldı.");
        },
      },
    } : {}),
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
  if (tab !== "ai" && reader.ai.isFull) reader.ai.setFull(false);
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

/** AI açılırken panel kapalıydıysa AI kapanınca panel de kapanır; açıktıysa İşaretler'e dönülür. */
let aiOpenedPanel = false;

function openAi(): void {
  if (!reader) return;
  if (rightTab !== "ai") aiOpenedPanel = !panelOpen;
  if (!panelOpen) togglePanel(true);
  if (focusMode) setFocus(false);
  showRightTab("ai");
}

/** AI'yı kapat: yalnız AI kapanır, İşaretler paneli önceki haline döner. */
function closeAi(): void {
  if (!reader || rightTab !== "ai") return;
  if (reader.ai.isFull) reader.ai.setFull(false);
  const hidePanel = aiOpenedPanel || !panelOpen;
  aiOpenedPanel = false;
  showRightTab("marks");
  if (hidePanel) togglePanel(false);
  reader.stage.focus({ preventScroll: true });
}

/** Ctrl J: AI sekmesini aç/kapat. */
function toggleAi(): void {
  if (!reader || !aiOn()) return;
  if (panelOpen && rightTab === "ai") {
    closeAi();
    return;
  }
  openAi();
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

async function openFile(file: File, handle?: FsHandle, extra: Partial<FileRecord> = {}): Promise<void> {
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
  // Kilitli dosya: PIN doğrulanmadan açılmaz.
  if (existing?.lock && !(await unlock(existing))) {
    await doc.destroy();
    home?.showIdle();
    return;
  }
  const rec: FileRecord = {
    // Düzen bilgisi (klasör, etiket, kapak, kilit, not defteri) korunur.
    ...existing,
    ...extra,
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

// ---------- Son açılanları düzenleme, not defteri, kilit, paylaşım paketi ----------

async function unlock(rec: FileRecord): Promise<boolean> {
  let error = "";
  for (let i = 0; i < 5; i++) {
    const pin = await askPin(`„${rec.name}" kilitli`, "Açmak için PIN'i gir.", false, error);
    if (pin === null) return false;
    if (await checkLock(rec.lock!, pin)) return true;
    error = "PIN yanlış.";
  }
  toast("Çok fazla yanlış deneme.");
  return false;
}

async function organize(rec: FileRecord, what: import("./ui/home").Organize): Promise<void> {
  const all = await db.allFiles();
  const cur = (await db.getFile(rec.hash)) ?? rec;
  let next: FileRecord | null = null;
  if (what === "pin") next = { ...cur, pinned: !cur.pinned };
  else if (what === "folder") {
    const f = await askFolder(cur.folder ?? "", [...new Set(all.map((x) => x.folder).filter((x): x is string => !!x))]);
    if (f !== null) next = { ...cur, folder: f || undefined };
  } else if (what === "tags") {
    const t = await askTags(cur.tags ?? [], [...new Set(all.flatMap((x) => x.tags ?? []))]);
    if (t !== null) next = { ...cur, tags: t.length ? t : undefined };
  } else if (what === "cover") {
    const c = await askCover(cur.cover);
    if (c !== null) next = { ...cur, cover: c || undefined };
  } else if (what === "lock") {
    if (cur.lock) {
      if (!(await unlock(cur))) return;
      next = { ...cur, lock: undefined };
      toast("Kilit kaldırıldı.");
    } else {
      const pin = await askPin(`„${cur.name}" dosyasını kilitle`, "Bu tarayıcıda açmak için PIN istenir, kapak önizlemesi gizlenir. Not: veriler şifrelenmez; PIN'i unutursan kilidi kaldıramazsın ama yedekten geri yükleyebilirsin.", true);
      if (!pin) return;
      next = { ...cur, lock: await makeLock(pin) };
      await db.putMeta(`thumb:${cur.hash}`, null);
      toast("Dosya kilitlendi.");
    }
  } else if (what === "remove") {
    if (!(await confirmDialog({ title: "Listeden kaldırılsın mı?", text: `„${cur.name}" son açılanlardan kalkar. Vurgu ve notların silinmez; aynı dosyayı açınca geri gelir.`, ok: "Kaldır" }))) return;
    await db.deleteFile(cur.hash);
    await deleteCopy(cur.hash);
    await refreshRecent();
    return;
  }
  if (!next) return;
  await db.putFile(next);
  if (reader?.file.rec.hash === next.hash) reader.file.rec = next;
  await refreshRecent();
}

async function newNotebook(): Promise<void> {
  const c = await askNotebook();
  if (!c) return;
  // pdf-lib yalnızca burada yüklenir (açılış paketine girmez).
  const { createNotebook } = await import("./editor/notebook");
  const bytes = await createNotebook(c.template, c.pages, c.landscape, c.name);
  const name = /\.pdf$/i.test(c.name) ? c.name : `${c.name}.pdf`;
  await openFile(new File([bytes], name, { type: "application/pdf" }), undefined, { notebook: { template: c.template } });
  if (reader) {
    void setMode("write");
    toast("Not defteri hazır: Yaz modunda yazmaya başlayabilirsin. Sona sayfa eklemek için defterin en altındaki düğmeyi kullan.", undefined, 7000);
  }
}

/** Not defterinin sonuna sayfa ekle: dosya değişir, bütün işaretler yeni sürüme taşınır. */
async function appendNotebookPage(): Promise<void> {
  if (!reader?.file.rec.notebook) return;
  const r = reader;
  if (r.recorder.state !== "idle") {
    toast("Kayıt sürerken sayfa eklenemez; önce kaydı bitir.");
    return;
  }
  const template: Template = r.file.rec.notebook!.template;
  const { appendPages } = await import("./editor/notebook");
  const bytes = await appendPages(r.file.bytes, template, 1);
  const hash = await sha256(bytes.slice().buffer as ArrayBuffer);
  const old = r.file.rec;
  await db.moveFileData(old.hash, hash);
  const rec: FileRecord = { ...old, hash, size: bytes.byteLength, pageCount: old.pageCount + 1, lastPage: old.pageCount, lastOpened: Date.now() };
  await db.putFile(rec);
  await db.deleteFile(old.hash);
  if (opfsSupported()) {
    await saveCopy(hash, bytes);
    await deleteCopy(old.hash);
  }
  const doc = await openPdf(bytes.slice(), () => Promise.resolve(null));
  const mode = r.mode;
  await openReader({ rec, bytes, doc, title: r.file.title });
  if (mode === "write") void setMode("write");
  announce(`Sayfa ${rec.pageCount} eklendi`);
}

const BUNDLE = "calisma-masasi-paket";

/** Paylaşım paketi: PDF ve bu dosyanın bütün işaretleri tek dosyada (arkadaşına gönder, o da açsın). */
async function exportBundle(): Promise<void> {
  if (!reader) return;
  const r = reader;
  let bin = "";
  const bytes = r.file.bytes;
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const pkg = {
    format: BUNDLE, version: 1, name: r.file.rec.name, createdAt: Date.now(),
    pdf: btoa(bin), highlights, marks, cards: cards.filter((c) => c.status === "active"),
  };
  download(`${r.file.rec.name.replace(/\.pdf$/i, "")}.paket.json`, JSON.stringify(pkg), "application/json");
  toast("Paylaşım paketi indirildi: PDF ve bütün işaretlerin içinde. Alan kişi Paylaşım paketi aç ile açar.", undefined, 7000);
}

function pickBundle(): void {
  const input = h("input", { type: "file", accept: "application/json,.json" });
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const pkg = JSON.parse(await f.text()) as { format: string; name: string; pdf: string; highlights: Highlight[]; marks: Mark[]; cards?: Card[] };
      if (pkg.format !== BUNDLE) throw new Error("format");
      const bytes = Uint8Array.from(atob(pkg.pdf), (c) => c.charCodeAt(0));
      const hash = await sha256(bytes.slice().buffer as ArrayBuffer);
      // Paketteki işaretler bu dosyaya eklenir; aynı kimlikliler (önceden alınmış paket) güncellenir.
      await db.putHighlights(pkg.highlights.map((x) => ({ ...x, fileHash: hash })));
      await db.putMarks(pkg.marks.map((x) => ({ ...x, fileHash: hash })));
      if (pkg.cards?.length) await db.putCards(pkg.cards.map((x) => ({ ...x, fileHash: hash })));
      await openFile(new File([bytes], pkg.name, { type: "application/pdf" }));
      toast(`Paket açıldı: ${num(pkg.highlights.length)} vurgu, ${num(pkg.marks.length)} işaret.`);
    } catch {
      toast("Bu dosya bir Çalışma Masası paylaşım paketi değil.");
    }
  });
  input.click();
}

/** İlk sayfanın küçük resmi (kapak görünümü); kilitli dosyada üretilmez. */
async function saveThumb(file: OpenDoc): Promise<void> {
  if (file.rec.lock || (await db.getMeta(`thumb:${file.rec.hash}`))) return;
  try {
    const page = await file.doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 240 / vp1.width });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    await db.putMeta(`thumb:${file.rec.hash}`, c.toDataURL("image/jpeg", 0.72));
  } catch {
    /* önizleme olmadan da çalışır */
  }
}

// ---------- Otomatik yedek klasörü (Chromium) ----------

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: string }): Promise<string>;
  requestPermission?(o: { mode: string }): Promise<string>;
};

async function backupDir(): Promise<DirHandle | null> {
  return (await db.getMeta<DirHandle>("backupDir")) ?? null;
}

/** Yedeği seçilen klasöre yaz (izin verilmişse, sessizce). */
async function autoBackup(): Promise<void> {
  const dir = await backupDir();
  if (!dir) return;
  try {
    if ((await dir.queryPermission?.({ mode: "readwrite" })) !== "granted") return;
    const f = await dir.getFileHandle("calisma-masasi-yedek.json", { create: true });
    const w = await (f as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
    await w.write(JSON.stringify(await createBackup()));
    await w.close();
    await markBackedUp();
  } catch (err) {
    console.error(err);
  }
}

let autoBackupTimer = 0;
function scheduleAutoBackup(): void {
  clearTimeout(autoBackupTimer);
  autoBackupTimer = window.setTimeout(() => void autoBackup(), 20000);
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
    newNotebook: () => void newNotebook(),
    importBundle: () => pickBundle(),
    organize: (rec, what) => void organize(rec, what),
    thumb: (hash) => db.getMeta<string>(`thumb:${hash}`).then((x) => x ?? null),
    get view() {
      return settings.homeView ?? "list";
    },
    setView: (v) => void changeSettings({ ...settings, homeView: v }).then(() => refreshRecent()),
  });
  app.replaceChildren(home.el);
  document.title = "Çalışma Masası";
  await refreshRecent();
  // pdf.js açılış ekranı çizildikten sonra boşta yüklenir: ilk dosya beklemeden açılır.
  const idle = (window as Window & { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 800));
  idle(() => void loadPdfjs());
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
  scheduleAutoBackup();
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
  scheduleAutoBackup();
  indexMarks();
  const list = pages ?? [...Array(reader.viewer.pageCount).keys()];
  list.forEach(drawMarks);
  reader.rail.setDrawings(marksByPage);
  reader.panel.setData(highlights, settings.names, marks);
  updatePanelCount();
}

/** Kayıt sürerken eklenen işaret kaydın o anına bağlanır. */
function stamp(): { rec: { id: string; t: number } } | Record<string, never> {
  return reader && recId && reader.recorder.state === "recording" ? { rec: { id: recId, t: Math.round(reader.recorder.elapsed()) } } : {};
}

function addMark(m: Mark): void {
  // Yalnızca yeni işaret (geri alınıp yeniden eklenen eski işaret değil).
  if (!m.rec && Date.now() - m.createdAt < 3000) Object.assign(m, stamp());
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
  if (reader.recorder.state !== "idle") void finishRecording(reader);
  quizView = null;
  area = null;
  reader.audio.close();
  if (ocrRun) {
    ocrRun.stop = true;
    void stopOcr();
  }
  autoQueue = [];
  clearTimeout(autoTimer);
  autoPill?.remove();
  autoPill = null;
  review?.destroy();
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
  analyzed = new Map();
  autoQueue = [];
  autoSeen = new Set();
  recordings = await db.recordingsFor(file.rec.hash);
  const savedHw = (await db.getMeta<Record<string, OcrPage & { sig: string }>>(`hw:${file.rec.hash}`)) ?? {};
  hwPages = new Map(Object.entries(savedHw).map(([k, v]) => [Number(k), v]));
  indexHighlights();
  indexMarks();
  rightTab = "marks";
  railOpen = settings.railOpen && !isNarrow();
  panelOpen = settings.panelOpen && !isNarrow();

  const ghost = (label: string | Node, attrs: Record<string, string | EventListener> = {}, ...rest: Node[]) =>
    h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", ...attrs }, label, ...rest);

  const railBtn = ghost(icon("rail"), { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--icon is-desk", title: "Sayfa şeridi ( [ )", "aria-label": "Sayfa şeridi", "aria-pressed": String(railOpen), onclick: () => toggleRail() });
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
    ...(file.rec.notebook ? [{ label: "Sona sayfa ekle", run: () => void appendNotebookPage() }] : []),
    { label: "Metni tanıt (OCR): bu sayfa", run: () => void runOcr("page") },
    { label: "El yazısını tanı (aranabilir yap)", run: () => void runHandwriting(false) },
    { label: "Metni tanıt (OCR): tüm sayfalar", run: () => void runOcr("all") },
    { label: `Otomatik metin tanıma: ${settings.autoOcr === false ? "kapalı" : "açık"}`, hint: "Resimdeki ve seçilemeyen yazılar", run: () => {
      void changeSettings({ ...settings, autoOcr: settings.autoOcr === false });
      if (settings.autoOcr !== false && reader) scheduleAutoOcr(reader.viewer.current);
    } },
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
  // Üst çubuk: sık kullanılan düğmeler simge; ad ve kısayol ipucunda ve ekran okuyucuda.
  const iconBtn = (name: string, label: string, attrs: Record<string, string | EventListener> = {}) =>
    h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--icon", "aria-label": label, title: label, ...attrs }, icon(name));
  const themeBtn = iconBtn("moon", "Koyu tema", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--icon is-wide", onclick: () => void changeSettings({ ...settings, theme: resolvedTheme() === "dark" ? "light" : "dark" }) });
  const panelBtn = ghost(icon("panel"), { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--count", title: "İşaretler paneli ( ] )", "aria-label": "İşaretler", "aria-pressed": String(panelOpen), onclick: () => {
    if (panelOpen && rightTab !== "marks") {
      aiOpenedPanel = false;
      showRightTab("marks");
    } else togglePanel();
  } }, h("span", { class: "cm-num", text: num(highlights.length) }));
  // Dışa aktar menüsü: Markdown notları, vurgulu PDF ve Tekrar modu girişi.
  const exportBtn = h("button", { class: "cm-btn cm-btn--sm cm-btn--withicon", "aria-haspopup": "menu", "aria-label": "Dışa aktar", title: "Dışa aktar" }, icon("export"), h("span", { class: "is-wide", text: "Dışa aktar" }));
  exportBtn.addEventListener("click", () => openMenu(exportBtn, [
    { label: "Markdown notları…", hint: ".md", run: () => exportDialog("md") },
    { label: "Vurgulu PDF…", hint: ".pdf", run: () => exportDialog("pdf") },
    { label: "Word belgesi", hint: ".docx", run: () => void exportOffice("docx") },
    { label: "PowerPoint (her sayfa bir slayt)", hint: ".pptx", run: () => void exportOffice("pptx") },
    { label: "Bu sayfa resim olarak", hint: ".png", run: () => void exportOffice("png") },
    { label: "Tüm sayfalar resim olarak", hint: ".zip", run: () => void exportOffice("zip") },
    { label: "Paylaşım paketi (PDF + işaretler)", hint: ".json", run: () => void exportBundle() },
    "sep",
    { label: "Tekrar et", shortcut: "Alt T", run: () => openReview() },
  ], "right"));
  const recBtn = iconBtn("mic", "Ses kaydı (Alt R)", { "aria-haspopup": "menu" });
  recBtn.addEventListener("click", () => recordMenu(recBtn));
  const aiBtn = ghost(icon("sparkle"), { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--withicon", title: "AI paneli (Ctrl J)", "aria-label": "AI paneli", "aria-pressed": "false", onclick: () => toggleAi() }, h("span", { text: "AI" }));
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
      iconBtn("search", "Ara (Ctrl F)", { onclick: () => search.open(window.getSelection()?.toString().trim() || undefined) }),
      themeBtn,
      iconBtn("focus", "Odak modu (F)", { class: "cm-btn cm-btn--ghost cm-btn--sm cm-btn--icon is-wide", onclick: () => setFocus(!focusMode) }),
      exportBtn,
      sep(),
      recBtn,
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
    playRec: (rec) => playRecording(rec.id, rec.t - 2000),
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

  const recorder: Recorder = new Recorder(() => {
    audio.render();
    recBtn.classList.toggle("is-rec", recorder.state !== "idle");
  });
  const audio: AudioBar = new AudioBar(recorder, {
    stop: () => reader && void finishRecording(reader),
    transcript: (rec) => transcriptDialog(rec),
    time: (id, ms) => dimFuture(id, ms),
  });
  stageWrap.append(audio.el);

  const ai = new AiPanel({
    close: () => closeAi(),
    fullscreen: (on) => reader?.body.classList.toggle("is-ai-full", on),
    settings: () => settings.ai,
    context: (scope, withImage) => aiContext(scope, withImage),
    pickArea: () => void pickArea(),
    vision: () => visionReady(settings.ai),
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
    h("button", { class: `cm-tab${id === "marks" ? " is-on" : ""}`, role: "tab", "data-tab": id, "aria-selected": String(id === "marks"), onclick: () => {
      // Sekmeyle elle geçince panel açık kalsın.
      aiOpenedPanel = false;
      showRightTab(id);
    } }, label);
  const rtabs = h("div", { class: "cm-tabs cm-rtabs", role: "tablist", hidden: true }, tab("marks", "İşaretler"), tab("ai", "AI"));
  const right = h("div", { class: "cm-right" }, rtabs, panel.el, ai.el);
  // Genişlik tutamacı sağ sütunda: İşaretler ve AI sekmesinde de çalışır.
  right.prepend(panel.resizeEl);

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
    write, ai, aiBtn, rtabs, outline: [], mode: "read", recorder, audio,
  };
  renderModeSeg("read");
  applySettings();
  updateLayout();
  bindFocusPeek(root);

  // Oku modunda da yapışkan notlar (AI notu dahil) sürüklenerek taşınır; çift tıklayınca Yaz modunda düzenlenir.
  viewer.root.addEventListener("pointerdown", (e) => {
    if (reader?.mode !== "read" || e.button > 0) return;
    const t = e.target as HTMLElement;
    const el = t.closest<HTMLElement>(".cm-sticky");
    if (!el || t.closest(".cm-sticky__toggle, .cm-rich__check input")) return;
    const m = marks.find((x) => x.id === el.dataset.id);
    const pageEl = el.closest<HTMLElement>(".cm-page");
    if (m?.kind !== "sticky" || !pageEl) return;
    e.preventDefault();
    const box = pageEl.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dx = 0;
    let dy = 0;
    el.classList.add("is-dragging");
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      dx = ev.clientX - x0;
      dy = ev.clientY - y0;
      el.style.translate = `${dx}px ${dy}px`;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.classList.remove("is-dragging");
      el.style.translate = "";
      if (Math.hypot(dx, dy) < 3) return;
      const [x, y, w, hh] = m.box;
      const nx = Math.min(1 - Math.min(w, 0.05), Math.max(0, x + dx / box.width));
      const ny = Math.min(0.97, Math.max(0, y + dy / box.height));
      updateMark({ ...m, box: [nx, ny, w, hh], updatedAt: Date.now() });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  viewer.root.addEventListener("dblclick", (e) => {
    if (reader?.mode !== "read") return;
    const id = (e.target as HTMLElement).closest<HTMLElement>(".cm-sticky")?.dataset.id;
    if (id) void setMode("write").then(() => (reader?.write.setTool("select"), reader?.write.edit(id)));
  });
  viewer.ocrFor = (p) => ocrPages.get(p) ?? null;
  viewer.hwFor = (p) => hwPages.get(p) ?? null;
  await viewer.init((p) => byPage.get(p) ?? [], file.rec.lastPage);
  if (file.rec.scrollMode && file.rec.scrollMode !== viewer.scrollMode) viewer.setScrollMode(file.rec.scrollMode);
  updateZoomLabel();
  onPageChange(viewer.current);
  refreshHighlights();
  refreshMarks();
  applyHandwriting();
  void saveThumb(file);
  // Not defteri: sonsuz defter gibi, en altta sayfa ekle.
  if (file.rec.notebook) viewer.root.append(h("button", { class: "cm-btn cm-pages__add", onclick: () => void appendNotebookPage() }, "+ Sona sayfa ekle"));
  // Son sayfanın altında: AI ile quiz.
  quizzes = (await db.getMeta<Quiz[]>(`quiz:${file.rec.hash}`)) ?? [];
  quizView = new QuizSection({
    create: () => void createQuiz(),
    remove: async (id) => {
      if (!(await confirmDialog({ title: "Quiz silinsin mi?", text: "Bu quiz ve cevapların silinir.", ok: "Sil", danger: true }))) return;
      quizzes = quizzes.filter((q) => q.id !== id);
      void db.putMeta(`quiz:${file.rec.hash}`, quizzes);
      quizView?.render(quizzes);
    },
    goTo: (p) => reader?.viewer.goTo(Math.min(p, (reader?.viewer.pageCount ?? 1) - 1)),
    exportMd: (qz) => download(`${file.rec.name.replace(/\.pdf$/i, "")}-quiz.md`, quizMarkdown(qz), "text/markdown;charset=utf-8"),
    toCards: (qz) => quizToCards(qz),
    aiReady: () => aiOn() && aiReady(settings.ai),
    openAiSettings: aiSetup,
  });
  viewer.root.append(quizView.el);
  quizView.render(quizzes);
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
  scheduleAutoOcr(i);
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
  const ocr = ocrPages.get(i);
  const base = !own.trim() || ocr?.mode === "garbled"
    ? ocr?.text ?? own
    : ocr?.mode === "extra" && ocr.text ? `${own}\n${ocr.text}` : own;
  return hw ? `${base}\n${hw}` : base;
}

/** Sayfa OCR'a muhtaç mı (metinsiz, bozuk metin, resimdeki yazı)? Sonuç belge açıkken saklanır. */
function analysisOf(i: number): Promise<PageAnalysis> {
  const doc = reader!.file.doc;
  let a = analyzed.get(i);
  if (!a) {
    a = analyzePage(doc, i).catch(() => ({ need: "none" as const, boxes: [] }));
    analyzed.set(i, a);
  }
  return a;
}

/** Sayfayı tanı; ihtiyaca göre: tam metin, bozuk metnin yerine ya da yalnız PDF metninde olmayan kelimeler. */
async function ocrPageFor(i: number, onProgress?: (status: string, ratio: number) => void): Promise<OcrPage> {
  const doc = reader!.file.doc;
  const a = await analysisOf(i);
  const raw = await recognizePage(doc, i, onProgress);
  if (a.need === "extra") return { ...subtractBoxes(raw, a.boxes), mode: "extra" };
  return { ...raw, mode: a.need === "garbled" ? "garbled" : "full" };
}

/** Sayfa değişince (kısa gecikmeyle) görünen sayfa ve komşuları otomatik tanıma kuyruğuna girer. */
function scheduleAutoOcr(i: number): void {
  clearTimeout(autoTimer);
  if (settings.autoOcr === false) return;
  autoTimer = window.setTimeout(() => {
    if (!reader) return;
    const n = reader.viewer.pageCount;
    const near = [i, i + 1, i - 1, i + 2].filter((p) => p >= 0 && p < n && !ocrPages.has(p) && !autoSeen.has(p));
    // En yakın sayfa önce: eski kuyruktaki uzak sayfalar sona kalır.
    autoQueue = [...near, ...autoQueue.filter((p) => !near.includes(p))];
    void pumpAutoOcr();
  }, 700);
}

async function pumpAutoOcr(): Promise<void> {
  if (autoBusy || ocrRun || !reader) return;
  autoBusy = true;
  const r = reader;
  let found = 0;
  try {
    while (autoQueue.length && reader === r && !ocrRun && settings.autoOcr !== false) {
      const i = autoQueue.shift()!;
      if (autoSeen.has(i) || ocrPages.has(i)) continue;
      autoSeen.add(i);
      await new Promise<void>((res) => ((window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200)))(() => res(), { timeout: 1500 }));
      if (reader !== r) break;
      const a = await analysisOf(i);
      if (a.need === "none") continue;
      // Bozuk metinli sayfada vurgu varsa katmanı değiştirme (vurgular eski metne bağlı).
      if (a.need === "garbled" && byPage.get(i)?.length) continue;
      showAutoPill(`Yazılar tanınıyor · s. ${num(i + 1)}`);
      let page: OcrPage;
      try {
        page = await ocrPageFor(i, (st, ratio) => st.startsWith("loading") && showAutoPill(`Tanıma verisi yükleniyor… %${Math.round(ratio * 100)}`));
      } catch (err) {
        console.error(err);
        break;
      }
      if (reader !== r || ocrRun) break;
      if (!page.lines.length) continue;
      ocrPages.set(i, page);
      found++;
      r.viewer.refreshText(i);
      r.search.invalidate();
      await db.putMeta(`ocr:${r.file.rec.hash}`, Object.fromEntries(ocrPages));
    }
  } finally {
    autoBusy = false;
    if (reader === r) {
      autoPill?.remove();
      autoPill = null;
      // Taranmış belge uyarısı otomatik tanımadan sonra gereksiz.
      if (found) r.band.querySelector("[data-scanned]")?.remove();
    }
  }
}

function showAutoPill(text: string): void {
  if (!reader) return;
  if (!autoPill) {
    autoPill = h("div", { class: "cm-ocrpill", role: "status" }, h("span", { class: "cm-ocrpill__dot", "aria-hidden": "true" }), h("span", {}));
    document.body.append(autoPill);
  }
  (autoPill.lastChild as HTMLElement).textContent = text;
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
    if ((await analysisOf(i)).need !== "none") pages.push(i);
  }
  if (!pages.length) {
    ocrRun = null;
    toast(scope === "page" ? "Bu sayfadaki yazının tamamı zaten seçilebilir." : "Tanınacak sayfa yok: bütün sayfaların yazısı seçilebilir.");
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
      const page = await ocrPageFor(i, (status, ratio) => {
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

// ---------- Word, PowerPoint, resim ----------

async function exportOffice(kind: "docx" | "pptx" | "png" | "zip"): Promise<void> {
  if (!reader) return;
  const r = reader;
  const base = r.file.rec.name.replace(/\.pdf$/i, "");
  const office = await import("./export/office");
  let closeToast: (() => void) | undefined;
  try {
    if (kind === "docx") {
      const blob = await office.notesDocx({ title: r.file.title, names: settings.names, highlights, marks, handwriting: new Map([...hwPages].map(([p, v]) => [p, v.text])) });
      download(`${base}-notlar.docx`, blob, blob.type);
      toast("Word belgesi indirildi.");
      return;
    }
    // Sayfa görüntüleri işaretlerle birlikte: önce düzleştirilmiş PDF, sonra resim.
    closeToast = toast("Sayfalar hazırlanıyor…", undefined, 600000);
    const { exportAnnotatedPdf } = await import("./export/pdf");
    const flat = await exportAnnotatedPdf(r.file.bytes, highlights, marks, { mode: "flatten", colors: new Set(COLORS), withNotes: false, withWriting: true, names: settings.names });
    const only = kind === "png" ? [r.viewer.current] : undefined;
    const images = await office.renderPages(flat, kind === "pptx" ? 1600 : 2000, (d, t) => announce(`Sayfa ${d} / ${t}`), only);
    closeToast?.();
    if (kind === "png") download(`${base}-s${r.viewer.current + 1}.png`, await (await fetch(images[0].png)).blob(), "image/png");
    else if (kind === "zip") download(`${base}-sayfalar.zip`, await office.pagesZip(base, images), "application/zip");
    else {
      const blob = await office.pagesPptx(r.file.title, images, office.pageNotes(images.length, highlights, marks, settings.names));
      download(`${base}.pptx`, blob, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    }
    toast(kind === "png" ? "Sayfa resmi indirildi." : kind === "zip" ? `${num(images.length)} sayfa resmi indirildi.` : "PowerPoint dosyası indirildi.");
  } catch (err) {
    closeToast?.();
    console.error(err);
    toast("Dışa aktarılamadı. Sayfayı yenileyip tekrar dene.");
  }
}

// ---------- Ses kaydı ----------

function recordMenu(anchor: HTMLElement): void {
  if (!reader) return;
  const r = reader;
  const items: (MenuItem | "sep")[] = [];
  if (r.recorder.state !== "idle") {
    items.push(
      r.recorder.state === "recording" ? { label: "Duraklat", run: () => r.recorder.pause() } : { label: "Devam et", run: () => r.recorder.resume() },
      { label: "Kaydı bitir", shortcut: "Alt R", run: () => void finishRecording(r) },
    );
  } else {
    items.push({ label: "Kaydı başlat", shortcut: "Alt R", run: () => void startRecording() });
    if (canLiveTranscribe()) {
      items.push({ label: `Canlı yazıya dökme: ${settings.liveTranscribe ? "açık" : "kapalı"}`, hint: "Chrome'da ses Google'a gider", run: () => void changeSettings({ ...settings, liveTranscribe: !settings.liveTranscribe }) });
    }
  }
  if (recordings.length) {
    items.push("sep");
    for (const rec of [...recordings].reverse()) {
      items.push({ label: `▶ ${rec.title}`, hint: clock(rec.duration), run: () => playRecording(rec.id, 0) });
    }
    items.push("sep", { label: "Kayıtları yönet…", run: () => manageRecordings() });
  }
  openMenu(anchor, items, "right");
}

async function startRecording(): Promise<void> {
  if (!reader || reader.recorder.state !== "idle") return;
  if (!canRecord()) {
    toast("Bu tarayıcı ses kaydını desteklemiyor.");
    return;
  }
  reader.audio.close();
  try {
    await reader.recorder.start(!!settings.liveTranscribe && canLiveTranscribe());
  } catch {
    toast("Mikrofona erişilemedi. Tarayıcının adres çubuğundan mikrofon iznini kontrol et.");
    return;
  }
  recId = uid();
  announce("Ses kaydı başladı. Bu sırada eklediğin vurgu ve işaretler kaydın o anına bağlanır.");
}

async function finishRecording(r: Reader): Promise<void> {
  const id = recId;
  const out = await r.recorder.stop();
  recId = null;
  if (!out || !id) return;
  if (out.duration < 1000) {
    toast("Kayıt çok kısa; kaydedilmedi.");
    return;
  }
  const rec: Recording = {
    id, fileHash: r.file.rec.hash, createdAt: Date.now() - out.duration, duration: out.duration, mime: out.mime, blob: out.blob,
    title: `Kayıt ${recordings.filter((x) => x.fileHash === r.file.rec.hash).length + 1} · ${new Date().toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`,
    ...(out.transcript.length ? { transcript: out.transcript } : {}),
  };
  await db.putRecording(rec);
  if (reader === r) recordings = [...recordings, rec];
  toast(`Kayıt kaydedildi (${clock(out.duration)}). Kayıt sırasında eklediğin işaretlerden o ana gidebilirsin.`);
}

function playRecording(id: string, at: number): void {
  const rec = recordings.find((x) => x.id === id);
  if (!reader || !rec) {
    toast("Bu işaretin bağlı olduğu kayıt bulunamadı (silinmiş olabilir).");
    return;
  }
  if (reader.recorder.state !== "idle") return;
  reader.audio.play(rec, Math.max(0, at));
}

/** Çalarken o ana kadar eklenmemiş işaretler soluk (kayıttaki sıra görülür). */
let dimFrame = 0;
function dimFuture(id: string | null, ms: number): void {
  cancelAnimationFrame(dimFrame);
  dimFrame = requestAnimationFrame(() => {
    if (!reader) return;
    const root = reader.viewer.root;
    root.classList.toggle("is-replay", !!id);
    const future = new Set<string>();
    if (id) for (const x of [...highlights, ...marks]) if (x.rec?.id === id && x.rec.t > ms) future.add(x.id);
    root.querySelectorAll<Element>("[data-id]").forEach((el) => el.classList.toggle("is-future", future.has((el as HTMLElement).dataset.id!)));
  });
}

function transcriptDialog(rec: Recording): void {
  openTranscript({
    rec,
    ai: settings.ai,
    seek: (ms) => playRecording(rec.id, ms),
    save: (next) => {
      recordings = recordings.map((x) => (x.id === next.id ? next : x));
      void db.putRecording(next);
    },
    addNote: (text) => addAiNote(reader?.viewer.current ?? 0, text),
    download: (name, text) => download(name, text, "text/markdown;charset=utf-8"),
    copy: (t) => void navigator.clipboard?.writeText(t).then(() => toast("Kopyalandı"), () => toast("Panoya kopyalanamadı.")),
    openAiSettings: aiSetup,
  });
}

function manageRecordings(): void {
  const d = openDialog({ title: "Ses kayıtları", width: 560 });
  const render = () => {
    d.body.replaceChildren(...(recordings.length ? recordings.map((rec) =>
      h("div", { class: "cm-reclist__row" },
        h("div", {}, h("div", { text: rec.title }), h("div", { class: "cm-muted cm-num", style: "font-size:12px", text: `${clock(rec.duration)} · ${(rec.blob.size / 1048576).toFixed(1)} MB${rec.transcript?.length ? " · metni var" : ""}` })),
        h("div", { style: "display:flex;gap:4px" },
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => (d.close(), playRecording(rec.id, 0)) }, "Çal"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => (d.close(), transcriptDialog(rec)) }, "Metin"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => download(`${rec.title}.${rec.mime.includes("mp4") ? "m4a" : "webm"}`, rec.blob, rec.mime) }, "İndir"),
          h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: async () => {
            if (!(await confirmDialog({ title: "Kayıt silinsin mi?", text: `${rec.title} bu cihazdan silinir. İşaretler kalır, yalnızca kayda bağlantıları çalışmaz.`, ok: "Sil", danger: true }))) return;
            await db.deleteRecording(rec.id);
            recordings = recordings.filter((x) => x.id !== rec.id);
            if (reader?.audio.current?.id === rec.id) reader.audio.close();
            render();
          } }, "Sil"),
        ))) : [h("p", { class: "cm-muted", style: "margin:0", text: "Kayıt yok." })]),
      h("p", { class: "cm-muted", style: "margin:8px 0 0;font-size:12px", text: "Kayıtlar yalnızca bu tarayıcıda saklanır ve JSON yedeğe girmez; saklamak istediklerini indir." }));
  };
  render();
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
    h("div", { class: "cm-notice cm-notice--warn", role: "status", "data-scanned": "" },
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
    r.viewer.setReserveLeft(0);
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
    // Masaüstünde palet solda yüzer: sayfalar onun kadar sağa kayar (telefonda palet altta).
    if (!matchMedia("(max-width: 720px)").matches) r.viewer.setReserveLeft(r.write.el.offsetWidth + 16);
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
    ...stamp(),
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
  openAi();
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

// ---------- AI ile quiz ----------

/** Quiz kapsamının metni: uzun belgede her sayfadan dengeli parça (bütçe aşılmaz). */
async function quizContext(scope: QuizScope): Promise<{ label: string; text: string } | { error: string }> {
  if (!reader) return { error: "Açık dosya yok." };
  const budget = settings.ai.mode === "device" ? 6000 : 60000;
  if (scope.kind === "highlights") {
    const c = await aiContext("highlights");
    if ("error" in c) return c;
    return { label: c.label, text: c.pages.map((p) => `<sayfa no="${p.page + 1}">\n${p.text}\n</sayfa>`).join("\n") };
  }
  const cur = reader.viewer.current;
  const [a, b] = scope.kind === "all" ? [0, reader.viewer.pageCount - 1] : scope.kind === "page" ? [cur, cur] : [scope.from, scope.to];
  const texts: { page: number; text: string }[] = [];
  for (let i = a; i <= b; i++) {
    const t = (await textOf(i)).replace(/\s+\n/g, "\n").trim();
    if (t) texts.push({ page: i, text: t });
  }
  if (!texts.length) return { error: "Bu kapsamda metin yok (taranmışsa önce Metni tanıt (OCR))." };
  const total = texts.reduce((n, p) => n + p.text.length, 0);
  const share = total > budget ? budget / total : 1;
  const text = texts.map((p) => `<sayfa no="${p.page + 1}">\n${share < 1 ? p.text.slice(0, Math.max(200, Math.floor(p.text.length * share))) : p.text}\n</sayfa>`).join("\n");
  const label = a === b ? `s. ${num(a + 1)}` : `s. ${num(a + 1)}–${num(b + 1)}${share < 1 ? " (kısaltıldı)" : ""}`;
  return { label, text };
}

async function createQuiz(): Promise<void> {
  if (!reader || !quizView) return;
  const r = reader;
  const choice = await askQuiz({ pageCount: r.viewer.pageCount, current: r.viewer.current, highlights: highlights.length, last: lastQuiz });
  if (!choice) return;
  lastQuiz = choice.req;
  const ctx = await quizContext(choice.scope);
  if ("error" in ctx) return void toast(ctx.error);
  const names = Object.fromEntries(QTYPES) as Record<string, string>;
  quizView.setBusy(`${choice.req.count} soruluk quiz hazırlanıyor (${ctx.label})… Uzun belgede bir dakika sürebilir.`);
  try {
    let got = 0;
    const out = await askSimple(settings.ai, {
      system: QUIZ_SYSTEM,
      text: `<belge>\n${ctx.text}\n</belge>\n\n${quizPrompt(choice.req, names)}`,
      signal: new AbortController().signal,
      onText: (t) => {
        got += t.length;
        if (got % 400 < t.length) quizView?.setBusy(`Sorular yazılıyor… (${num(got)} karakter)`);
      },
    });
    const parsed = parseQuiz(out);
    if (!parsed) {
      quizView.setBusy("");
      toast("AI'nın cevabı quiz biçiminde değildi. Yeniden dene ya da daha az soru iste.", undefined, 7000);
      return;
    }
    const typesLabel = choice.req.types.map((t) => names[t]).join(", ");
    const qz: Quiz = {
      id: uid(), title: parsed.title, createdAt: Date.now(), questions: parsed.questions,
      summary: `${parsed.questions.length} soru · ${typesLabel} · ${choice.req.level} · ${ctx.label}`,
    };
    if (reader !== r) return;
    quizzes = [...quizzes, qz];
    await db.putMeta(`quiz:${r.file.rec.hash}`, quizzes);
    quizView.setBusy("");
    quizView.render(quizzes);
    quizView.el.scrollIntoView({ block: "start", behavior: "smooth" });
    announce(`Quiz hazır: ${parsed.questions.length} soru`);
  } catch (err) {
    quizView.setBusy("");
    const e = await aiError(settings.ai, err);
    toast(`${e.title}. ${e.text}`, undefined, 8000);
  }
}

/** Quiz soruları Tekrar modu kartı olur (soru ön yüz, cevap ve açıklama arka yüz). */
function quizToCards(qz: Quiz): void {
  if (!reader) return;
  const now = Date.now();
  const made: Card[] = qz.questions.map((q) => {
    const front = q.type === "mc" ? `${q.q}\n${q.options!.map((o, k) => `${String.fromCharCode(65 + k)}) ${o}`).join("\n")}` : q.type === "tf" ? `Doğru mu, yanlış mı? ${q.q}` : q.q;
    const ans = q.type === "mc" ? `${String.fromCharCode(65 + (q.answer as number))}) ${q.options![q.answer as number]}` : q.type === "tf" ? (q.answer ? "Doğru" : "Yanlış") : String(q.answer);
    return {
      id: uid(), fileHash: reader!.file.rec.hash, page: Math.max(0, (q.page ?? 1) - 1), source: "ai", front, back: q.explanation ? `${ans}\n${q.explanation}` : ans,
      status: "active", ...freshSchedule(now), createdAt: now, updatedAt: now,
    } as Card;
  });
  cards = [...cards, ...made];
  void db.putCards(made);
  toast(`${num(made.length)} kart Tekrar moduna eklendi (Alt T).`);
}

// ---------- Alan seç ve sor ----------

/** Son seçilen alan: sayfa, kutu (0–1), görüntüsü ve içindeki metin. */
let area: { file: string; page: number; rect: Rect; text: string; image: NonNullable<AiContext["image"]> } | null = null;

/** Sayfanın bir bölgesini (işaretler hariç, PDF'in kendisi) yüksek çözünürlükte çiz. */
async function areaCanvas(page: number, rect: Rect, maxSide: number): Promise<HTMLCanvasElement | null> {
  if (!reader) return null;
  const p = await reader.file.doc.getPage(page + 1);
  const vp1 = p.getViewport({ scale: 1 });
  const [x, y, w, hh] = rect;
  const scale = Math.min(4, maxSide / Math.max(w * vp1.width, hh * vp1.height));
  const vp = p.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * vp.width));
  c.height = Math.max(1, Math.round(hh * vp.height));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  // Bölgenin dışı çizilmez: görünüm kaydırılır.
  await p.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x * vp.width, -y * vp.height] }).promise;
  return c;
}

async function pageImage(page: number, rect: Rect, maxSide: number): Promise<AiContext["image"]> {
  const c = await areaCanvas(page, rect, maxSide);
  if (!c) return undefined;
  const png = c.width * c.height < 1_200_000;
  const url = c.toDataURL(png ? "image/png" : "image/jpeg", 0.9);
  const t = document.createElement("canvas");
  const k = Math.min(1, 220 / c.width);
  t.width = Math.round(c.width * k);
  t.height = Math.round(c.height * k);
  t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
  return { base64: url.split(",")[1], mediaType: png ? "image/png" : "image/jpeg", thumb: t.toDataURL("image/jpeg", 0.8) };
}

/** Metin katmanında kutunun içindeki yazı (satır sırasıyla). */
async function textInRect(page: number, rect: Rect): Promise<string> {
  if (!reader) return "";
  const layer = await reader.viewer.whenText(page);
  const box = reader.viewer.pageElement(page)!.getBoundingClientRect();
  const [x, y, w, hh] = rect;
  const parts: { t: string; top: number; left: number }[] = [];
  for (const span of layer.querySelectorAll<HTMLElement>("span")) {
    if (!span.textContent?.trim() || span.querySelector("span")) continue;
    const r = span.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - box.left) / box.width;
    const cy = (r.top + r.height / 2 - box.top) / box.height;
    if (cx >= x && cx <= x + w && cy >= y && cy <= y + hh) parts.push({ t: span.textContent, top: Math.round(cy * 400), left: cx });
  }
  parts.sort((a, b) => a.top - b.top || a.left - b.left);
  let out = "";
  let line = -1;
  for (const p of parts) {
    out += line === -1 ? p.t : p.top !== line ? `\n${p.t}` : p.t;
    line = p.top;
  }
  return out.replace(/[ \t]+/g, " ").trim();
}

/**
 * Alan seç: sayfada sürükleyerek bir kutu çiz (fare, kalem ya da parmak). Kutunun görüntüsü ve
 * içindeki metin AI kapsamı olur; şekil, formül ve tablolar da görülür. Esc vazgeçer.
 */
async function pickArea(): Promise<void> {
  if (!reader) return;
  const r = reader;
  const narrow = isNarrow();
  if (narrow && panelOpen) togglePanel(false);
  if (r.ai.isFull) r.ai.setFull(false);
  const root = r.viewer.root;
  root.classList.add("is-area-pick");
  const hint = h("div", { class: "cm-areahint", role: "status", text: "Sormak istediğin yeri sürükleyerek çerçevele · Esc vazgeç" });
  r.stage.parentElement?.append(hint);
  announce("Alan seç: sormak istediğin yeri sürükleyerek çerçevele");
  const rect = await new Promise<{ page: number; rect: Rect } | null>((resolve) => {
    const finish = (v: { page: number; rect: Rect } | null) => {
      root.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      root.classList.remove("is-area-pick");
      hint.remove();
      resolve(v);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    };
    const down = (e: PointerEvent) => {
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>(".cm-page");
      if (!pageEl) return;
      e.preventDefault();
      e.stopPropagation();
      const b = pageEl.getBoundingClientRect();
      const x0 = (e.clientX - b.left) / b.width;
      const y0 = (e.clientY - b.top) / b.height;
      const box = h("div", { class: "cm-areabox" });
      pageEl.append(box);
      let cur: Rect = [x0, y0, 0, 0];
      const move = (ev: PointerEvent) => {
        const x1 = Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width));
        const y1 = Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height));
        cur = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
        box.style.cssText = `left:${cur[0] * 100}%;top:${cur[1] * 100}%;width:${cur[2] * 100}%;height:${cur[3] * 100}%`;
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        box.remove();
        // Çok küçük çerçeve: tıklama sayılır, seçim sürer.
        if (cur[2] * b.width < 12 || cur[3] * b.height < 12) return;
        finish({ page: Number(pageEl.dataset.page), rect: cur });
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };
    root.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
  });
  if (!rect || reader !== r) return;
  const [text, image] = await Promise.all([textInRect(rect.page, rect.rect), pageImage(rect.page, rect.rect, 1400)]);
  area = { file: r.file.rec.hash, page: rect.page, rect: rect.rect, text, image: image! };
  openAi();
  r.ai.areaPicked();
}

/** Kapsamın metni. Dosyanın tamamı asla kendiliğinden gönderilmez; uzun kapsam kırpılmaz, söylenir. */
async function aiContext(scope: Scope, withImage = false): Promise<AiContext | { error: string }> {
  if (!reader) return { error: "Açık dosya yok." };
  const cur = reader.viewer.current;
  const hlPages = (list: Highlight[], label: string, withWriting = false): AiContext | { error: string } => {
    const pages = new Map<number, string[]>();
    for (const x of [...list].sort(readingOrder)) {
      const line = `- [${settings.names[x.color]}] ${x.text}${x.note.trim() ? ` (Notum: ${x.note.trim()})` : ""}`;
      pages.set(x.page, [...(pages.get(x.page) ?? []), line]);
    }
    // "Vurgularım": metin kutuları, yapışkan notlar ve tanınmış el yazısı da girer.
    let written = 0;
    if (withWriting) {
      for (const m of marks) {
        if ((m.kind === "text" || (m.kind === "sticky" && !m.ai)) && m.text.trim()) {
          pages.set(m.page, [...(pages.get(m.page) ?? []), `- [Yazdığım not] ${richPlain(m.text).replace(/\n/g, " / ")}`]);
          written++;
        }
      }
      for (const [p, hw] of hwPages) {
        pages.set(p, [...(pages.get(p) ?? []), `- [El yazım] ${hw.text.replace(/\n/g, " / ")}`]);
        written++;
      }
    }
    if (!pages.size) return { error: "Bu kapsamda vurgu yok." };
    return {
      label: written ? `${label}, ${num(written)} not` : label,
      pages: [...pages].sort((a, b) => a[0] - b[0]).map(([page, lines]) => ({ page, text: lines.join("\n") })),
    };
  };
  switch (scope) {
    case "selection": {
      if (!lastSelection?.length) return { error: "Önce sayfada metin seç, sonra Sor'a bas ya da A." };
      const pages = lastSelection.map((p) => ({ page: p.page, text: p.text }));
      return { label: `seçim (s. ${pages.map((p) => p.page + 1).join(", ")})`, pages };
    }
    case "page": {
      const text = await textOf(cur);
      // Görüntü de gidiyorsa metni olmayan (taranmış, şekilli) sayfa da sorulabilir.
      const image = withImage && visionReady(settings.ai) ? await pageImage(cur, [0, 0, 1, 1], 1400) : undefined;
      if (!text.trim() && !image) return { error: "Bu sayfada seçilebilir metin yok (taranmış olabilir). Alan seç ile sor ya da Dosya menüsünden Metni tanıt (OCR)." };
      return { label: `sayfa ${num(cur + 1)}`, pages: [{ page: cur, text: text.trim() ? text : "(Bu sayfada seçilebilir metin yok; görüntüye bak.)" }], image };
    }
    case "area": {
      if (!area || area.file !== reader.file.rec.hash) return { error: "Önce Alan seç ile sayfada sormak istediğin yeri çerçevele." };
      const vision = visionReady(settings.ai);
      let text = area.text;
      // Görüntü gönderemeyen sağlayıcıda (cihazda, yerel) alanın yazısı bu cihazda tanınır.
      if (!vision && !text.trim()) {
        const canvas = await areaCanvas(area.page, area.rect, 1600);
        text = canvas ? (await recognizeCanvas(canvas)).text : "";
      }
      if (!vision && !text.trim()) return { error: "Bu alanda metin yok. Şekil ve formülleri okutmak için görüntü destekleyen bir AI seç (Gemini, Claude, OpenAI)." };
      return {
        label: `seçilen alan (s. ${num(area.page + 1)})`,
        pages: [{ page: area.page, text: text.trim() ? text : "(Bu alanda seçilebilir metin yok; görüntüye bak.)" }],
        image: vision ? area.image : undefined,
      };
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
      return hlPages(highlights, `${num(highlights.length)} vurgu`, true);
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
  review.destroy();
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

// Odak çerçevesi yalnızca klavyeyle gezinirken (Tab); fare ve dokunuşta gizlenir.
document.addEventListener("keydown", (e) => e.key === "Tab" && (document.documentElement.dataset.kbd = "1"), true);
document.addEventListener("pointerdown", () => delete document.documentElement.dataset.kbd, true);

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
  // AI tam ekrandayken Esc geri getirir.
  if (e.key === "Escape" && r.ai.isFull && !isTyping(e)) {
    e.preventDefault();
    r.ai.setFull(false);
    return;
  }
  // Shift A: alan seç ve AI'ya sor (şekil, formül, tablo dahil).
  if (e.shiftKey && !ctrl && !e.altKey && e.code === "KeyA" && !isTyping(e) && aiOn() && r.mode !== "edit") {
    e.preventDefault();
    void pickArea();
    return;
  }
  if (e.altKey && !ctrl && e.code === "KeyR") {
    e.preventDefault();
    if (r.recorder.state === "idle") void startRecording();
    else void finishRecording(r);
    return;
  }
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

