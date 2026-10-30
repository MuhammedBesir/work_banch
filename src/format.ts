// Sayılar ve tarihler Türkçe biçimde: 1.840 sayfa, 18,4 MB, %68.

const nf = new Intl.NumberFormat("tr-TR");
const nf1 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

export const num = (n: number): string => nf.format(n);

export function bytes(n: number): string {
  if (n < 1024) return `${num(n)} B`;
  if (n < 1024 ** 2) return `${nf1.format(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${nf1.format(n / 1024 ** 2)} MB`;
  return `${nf1.format(n / 1024 ** 3)} GB`;
}

export const percent = (ratio: number): string => `%${Math.round(ratio * 100)}`;

const time = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const longDate = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });

export const dateLong = (t: number): string => longDate.format(t);

/** "Bugün, 14:20", "Dün", "3 gün önce", "2 hafta önce", ya da tarih. */
export function relative(t: number, now = Date.now()): string {
  const startOfDay = (d: number) => new Date(d).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
  if (days <= 0) return `Bugün, ${time.format(t)}`;
  if (days === 1) return "Dün";
  if (days < 7) return `${days} gün önce`;
  if (days < 30) return `${Math.floor(days / 7)} hafta önce`;
  return longDate.format(t);
}

/** Türkçe büyük/küçük harf duyarsız karşılaştırma için. */
export const fold = (s: string): string => s.toLocaleLowerCase("tr-TR");
