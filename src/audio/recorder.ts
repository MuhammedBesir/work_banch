// Ders kaydı: mikrofon bu tarayıcıda kaydedilir, IndexedDB'de saklanır, hiçbir yere gönderilmez.
// İsteğe bağlı canlı yazıya dökme tarayıcının konuşma tanımasını kullanır (Chrome'da ses Google'a gider).

export type RecState = "idle" | "recording" | "paused";

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

const SpeechCtor = (): (new () => SpeechRec) | undefined =>
  (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;

export const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
export const canLiveTranscribe = () => !!SpeechCtor();

const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export class Recorder {
  state: RecState = "idle";
  private media: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private acc = 0;
  private since = 0;
  private speech: SpeechRec | null = null;
  readonly transcript: { t: number; text: string }[] = [];

  constructor(private onChange: () => void) {}

  /** Kaydın başından bu yana geçen süre (duraklatmalar hariç), ms. */
  elapsed(): number {
    return this.acc + (this.state === "recording" ? performance.now() - this.since : 0);
  }

  async start(live: boolean): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
    // Konuşma için düşük bit hızı yeter: saatlik kayıt ~15 MB.
    this.media = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
    this.chunks = [];
    this.media.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.media.start(1000);
    this.acc = 0;
    this.since = performance.now();
    this.transcript.length = 0;
    this.state = "recording";
    if (live) this.startSpeech();
    this.onChange();
  }

  private startSpeech(): void {
    const Ctor = SpeechCtor();
    if (!Ctor) return;
    const s = new Ctor();
    s.lang = "tr-TR";
    s.continuous = true;
    s.interimResults = false;
    let segStart = this.elapsed();
    s.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal && r[0].transcript.trim()) {
          this.transcript.push({ t: Math.max(0, Math.round(segStart)), text: r[0].transcript.trim() });
          segStart = this.elapsed();
        }
      }
      this.onChange();
    };
    // Tarayıcı bir süre sessizlikte tanımayı kapatır: kayıt sürerken yeniden başlat.
    s.onend = () => {
      if (this.speech === s && this.state === "recording") {
        segStart = this.elapsed();
        try {
          s.start();
        } catch {
          /* zaten çalışıyor */
        }
      }
    };
    s.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") this.speech = null;
    };
    this.speech = s;
    try {
      s.start();
    } catch {
      this.speech = null;
    }
  }

  pause(): void {
    if (this.state !== "recording" || !this.media) return;
    this.media.pause();
    this.acc += performance.now() - this.since;
    this.state = "paused";
    this.speech?.stop();
    this.onChange();
  }

  resume(): void {
    if (this.state !== "paused" || !this.media) return;
    this.media.resume();
    this.since = performance.now();
    this.state = "recording";
    try {
      this.speech?.start();
    } catch {
      /* zaten çalışıyor */
    }
    this.onChange();
  }

  async stop(): Promise<{ blob: Blob; mime: string; duration: number; transcript: { t: number; text: string }[] } | null> {
    const media = this.media;
    if (!media || this.state === "idle") return null;
    const duration = Math.round(this.elapsed());
    const speech = this.speech;
    this.speech = null;
    speech?.stop();
    const done = new Promise<void>((resolve) => (media.onstop = () => resolve()));
    media.stop();
    await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.media = null;
    this.state = "idle";
    const mime = media.mimeType || "audio/webm";
    const blob = new Blob(this.chunks, { type: mime });
    this.chunks = [];
    this.onChange();
    return { blob, mime, duration, transcript: [...this.transcript] };
  }
}

export const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
