import { askSimple, friendlyError, ready } from "../ai/client";
import type { AiSettings, Recording } from "../types";
import { h } from "../util";
import { openDialog } from "../ui/dialog";
import { clock } from "./recorder";

const SUMMARY_SYSTEM = `Bir üniversite dersinin ses kaydının yazıya dökülmüş metnini özetle.
Biçim: önce 2–3 cümlelik genel özet, sonra "- " ile başlayan 5–10 madde (önemli kavramlar, tanımlar, hocanın vurguladığı yerler, ödev ve sınav bilgisi).
Her maddenin sonuna metindeki zamanı [dk:sn] biçiminde ekle. Türkçe, sade yaz. Metinde olmayanı ekleme.
Metin konuşmadan otomatik çıkarıldı, yazım hataları olabilir.`;

export interface TranscriptOptions {
  rec: Recording;
  ai: AiSettings;
  seek(ms: number): void;
  save(rec: Recording): void;
  addNote(text: string): void;
  download(name: string, text: string): void;
  copy(text: string): void;
  openAiSettings(): void;
}

/** Kaydın metni: zaman damgalı satırlar (tıklayınca o ana gider), yazıya dökme ve AI özeti. */
export function openTranscript(o: TranscriptOptions): void {
  const d = openDialog({ title: `${o.rec.title} · ${clock(o.rec.duration)}`, width: 720 });
  let rec = o.rec;
  let ctrl: AbortController | null = null;
  const list = h("div", { class: "cm-transcript", role: "list" });
  const status = h("p", { class: "cm-muted", style: "margin:0;font-size:13px", "aria-live": "polite" });
  const summary = h("div", { class: "cm-transcript__summary", hidden: true });
  const asText = () => (rec.transcript ?? []).map((s) => `[${clock(s.t)}] ${s.text}`).join("\n");

  const renderList = () => {
    const segs = rec.transcript ?? [];
    list.replaceChildren(...segs.map((s) =>
      h("div", { class: "cm-transcript__row", role: "listitem" },
        h("button", { class: "cm-linkbtn cm-num", title: "Bu ana git", onclick: () => o.seek(s.t) }, clock(s.t)),
        h("span", { text: s.text }))));
    if (!segs.length) list.append(h("p", { class: "cm-muted", style: "margin:0", text: "Bu kaydın metni yok." }));
    actions();
  };

  const canWhisper = o.ai.mode === "openai" && ready(o.ai);
  const transcribe = async () => {
    ctrl?.abort();
    const c = (ctrl = new AbortController());
    const { transcribe: run, MAX_BYTES } = await import("../ai/transcribe");
    if (rec.blob.size > MAX_BYTES) {
      status.textContent = "Kayıt 25 MB'tan büyük; OpenAI bu boyutu kabul etmiyor. Daha kısa kayıtlar al.";
      return;
    }
    status.textContent = "Yazıya dökülüyor… (kayıt OpenAI'ye gönderildi)";
    try {
      const segs = await run(rec.blob, rec.mime, o.ai.keys.openai, c.signal);
      rec = { ...rec, transcript: segs };
      o.save(rec);
      status.textContent = segs.length ? `${segs.length} parça yazıya döküldü.` : "Kayıtta konuşma bulunamadı.";
      renderList();
    } catch (err) {
      if (!c.signal.aborted) status.textContent = Object.values(await friendlyError(o.ai, err)).join(". ");
    }
  };

  const summarize = async () => {
    ctrl?.abort();
    const c = (ctrl = new AbortController());
    summary.hidden = false;
    summary.textContent = "";
    status.textContent = "Özetleniyor…";
    try {
      const text = await askSimple(o.ai, { system: SUMMARY_SYSTEM, text: asText().slice(0, 60000), signal: c.signal, onText: (t) => (summary.textContent += t) });
      summary.textContent = text;
      status.textContent = "Özet hazır.";
      actions();
    } catch (err) {
      if (!c.signal.aborted) status.textContent = Object.values(await friendlyError(o.ai, err)).join(". ");
    }
  };

  function actions(): void {
    const has = !!rec.transcript?.length;
    d.foot.replaceChildren(...[
      has ? h("button", { class: "cm-btn cm-btn--ghost", onclick: () => o.download(`${rec.title}.md`, `# ${rec.title}\n\n${asText()}\n${summary.textContent ? `\n## Özet\n\n${summary.textContent}\n` : ""}`) }, "İndir (.md)") : null,
      has ? h("button", { class: "cm-btn cm-btn--ghost", onclick: () => o.copy(asText()) }, "Kopyala") : null,
      !summary.hidden && summary.textContent ? h("button", { class: "cm-btn cm-btn--ghost", onclick: () => o.addNote(`Ders özeti (${rec.title})\n${summary.textContent}`) }, "Özeti not olarak ekle") : null,
      canWhisper ? h("button", { class: "cm-btn cm-btn--ghost", onclick: () => void transcribe() }, has ? "Yeniden yazıya dök" : "Yazıya dök (OpenAI)") : null,
      has && ready(o.ai) && o.ai.mode !== "off" ? h("button", { class: "cm-btn", onclick: () => void summarize() }, "AI ile özetle") : null,
    ].filter((x): x is HTMLButtonElement => !!x));
  }

  if (!rec.transcript?.length && !canWhisper) {
    status.replaceChildren(
      "Yazıya dökmek için iki yol var: kayda başlarken Canlı yazıya dökme'yi aç (tarayıcının konuşma tanıması) ya da ",
      h("button", { class: "cm-linkbtn", style: "color:var(--accent)", onclick: () => (d.close(), o.openAiSettings()) }, "OpenAI anahtarı gir"),
      " (kayıt yalnızca sen isteyince gönderilir).",
    );
  }
  d.body.append(status, list, summary);
  renderList();
  const close = d.close;
  d.close = () => {
    ctrl?.abort();
    close();
  };
}
