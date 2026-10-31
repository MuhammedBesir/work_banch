import type { Recording } from "../types";
import { h } from "../util";
import { clock, type Recorder } from "./recorder";

export interface AudioActions {
  stop(): void;
  transcript(rec: Recording): void;
  /** Çalarken: kayıt ve konum (ms); kapanınca `null`. */
  time(id: string | null, ms: number): void;
}

const SPEEDS = [1, 1.25, 1.5, 2];

/**
 * Sahnenin altında yüzen ses çubuğu: kayıt sırasında süre ve düğmeler, çalarken oynatıcı.
 * Kayıttaki an ile işaretler eşzamanlı: çalarken o ana kadar eklenmemiş işaretler soluk görünür.
 */
export class AudioBar {
  readonly el: HTMLElement;
  private audio = new Audio();
  private playing: Recording | null = null;
  private url = "";
  private timer = 0;
  private speed = 0;

  constructor(private recorder: Recorder, private actions: AudioActions) {
    this.el = h("div", { class: "cm-audiobar", role: "region", "aria-label": "Ses kaydı", hidden: true });
    this.audio.preload = "metadata";
    this.audio.addEventListener("timeupdate", () => {
      this.renderTime();
      if (this.playing) this.actions.time(this.playing.id, this.audio.currentTime * 1000);
    });
    this.audio.addEventListener("play", () => this.render());
    this.audio.addEventListener("pause", () => this.render());
  }

  get current(): Recording | null {
    return this.playing;
  }

  /** Kaydı `at` ms'den çal (işarete tıklayınca 2 sn önceden). */
  play(rec: Recording, at = 0): void {
    if (this.playing?.id !== rec.id) {
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(rec.blob);
      this.audio.src = this.url;
      this.playing = rec;
    }
    const seek = () => {
      this.audio.currentTime = Math.max(0, at / 1000);
      void this.audio.play().catch(() => {});
    };
    if (this.audio.readyState >= 1) seek();
    else this.audio.addEventListener("loadedmetadata", seek, { once: true });
    this.render();
  }

  seek(ms: number): void {
    if (this.playing) this.play(this.playing, ms);
  }

  close(): void {
    this.audio.pause();
    this.playing = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    this.actions.time(null, 0);
    this.render();
  }

  private renderTime(): void {
    const t = this.el.querySelector<HTMLElement>(".cm-audiobar__time");
    const range = this.el.querySelector<HTMLInputElement>(".cm-audiobar__range");
    if (this.playing) {
      const dur = this.playing.duration;
      if (t) t.textContent = `${clock(this.audio.currentTime * 1000)} / ${clock(dur)}`;
      if (range && document.activeElement !== range) range.value = String(Math.round(this.audio.currentTime * 1000));
    } else if (t) t.textContent = clock(this.recorder.elapsed());
  }

  render(): void {
    clearInterval(this.timer);
    const rec = this.recorder.state;
    if (rec !== "idle") {
      // Kayıt sürerken oynatıcı kapanır (aynı anda kayıt ve çalma karışmasın).
      if (this.playing) {
        this.audio.pause();
        this.playing = null;
      }
      const last = this.recorder.transcript.at(-1)?.text;
      this.el.hidden = false;
      this.el.replaceChildren(
        h("span", { class: `cm-audiobar__dot${rec === "paused" ? " is-paused" : ""}`, "aria-hidden": "true" }),
        h("span", { class: "cm-audiobar__label", text: rec === "paused" ? "Duraklatıldı" : "Kaydediliyor" }),
        h("span", { class: "cm-num cm-audiobar__time", "aria-live": "off" }),
        ...(last ? [h("span", { class: "cm-audiobar__live", title: last, text: `“${last}”` })] : []),
        rec === "recording"
          ? h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.recorder.pause() }, "Duraklat")
          : h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.recorder.resume() }, "Devam"),
        h("button", { class: "cm-btn cm-btn--sm", onclick: () => this.actions.stop() }, "Bitir"),
      );
      this.renderTime();
      this.timer = window.setInterval(() => this.renderTime(), 500);
      return;
    }
    if (!this.playing) {
      this.el.hidden = true;
      this.el.replaceChildren();
      return;
    }
    const p = this.playing;
    const range = h("input", { type: "range", class: "cm-audiobar__range", min: "0", max: String(p.duration), step: "100", "aria-label": "Konum" });
    range.addEventListener("input", () => (this.audio.currentTime = Number(range.value) / 1000));
    const paused = this.audio.paused;
    this.el.hidden = false;
    this.el.replaceChildren(
      h("button", { class: "cm-btn cm-btn--sm cm-audiobar__play", "aria-label": paused ? "Çal" : "Duraklat", onclick: () => (paused ? void this.audio.play() : this.audio.pause()) }, paused ? "▶" : "❚❚"),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-label": "10 saniye geri", onclick: () => (this.audio.currentTime = Math.max(0, this.audio.currentTime - 10)) }, "−10"),
      h("span", { class: "cm-audiobar__label", text: p.title }),
      range,
      h("span", { class: "cm-num cm-audiobar__time" }),
      h("button", {
        class: "cm-btn cm-btn--ghost cm-btn--sm cm-num", "aria-label": "Hız",
        onclick: () => {
          this.speed = (this.speed + 1) % SPEEDS.length;
          this.audio.playbackRate = SPEEDS[this.speed];
          this.render();
        },
      }, `${SPEEDS[this.speed]}×`),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", onclick: () => this.actions.transcript(p) }, "Metin"),
      h("button", { class: "cm-btn cm-btn--ghost cm-btn--sm", "aria-label": "Oynatıcıyı kapat", onclick: () => this.close() }, "Kapat"),
    );
    this.renderTime();
  }
}
