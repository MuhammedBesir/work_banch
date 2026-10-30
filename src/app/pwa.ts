import { toast } from "../ui/toast";

// Çevrimdışı çalışma ve "uygulama olarak kur". Yalnızca üretim derlemesinde (geliştirmede önbellek karışmasın).

let installEvent: (Event & { prompt(): Promise<void> }) | null = null;

export function registerPwa(onFiles: (files: File[], handles: FileSystemFileHandle[]) => void): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as typeof installEvent;
  });

  // Uygulama olarak kurulduysa PDF'ler işletim sisteminden "Birlikte aç" ile gelebilir.
  type LaunchParams = { files: FileSystemFileHandle[] };
  const lq = (window as Window & { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue;
  lq?.setConsumer(async (p) => {
    if (!p.files?.length) return;
    const files = await Promise.all(p.files.map((h) => h.getFile()));
    onFiles(files, p.files);
  });

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      const offerUpdate = (w: ServiceWorker) =>
        toast("Yeni sürüm hazır", { label: "Yenile", run: () => w.postMessage("SKIP_WAITING") }, 15000);
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    } catch {
      /* çevrimdışı çalışma olmadan da uygulama çalışır */
    }
  };
  // Sayfa çoktan yüklenmiş olabilir (uygulama açılışı ayarları beklerken).
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register(), { once: true });
}

export const canInstall = (): boolean => !!installEvent;

export async function install(): Promise<void> {
  if (!installEvent) {
    toast("Tarayıcının menüsünden \"Uygulamayı yükle\" / \"Ana ekrana ekle\" ile kurabilirsin.", undefined, 6000);
    return;
  }
  await installEvent.prompt();
  installEvent = null;
}

export const isInstalled = (): boolean => matchMedia("(display-mode: standalone)").matches;
