// Not defteri sayfa şablonları (pdf-lib'e bağlı değil: arayüz bunu açılışta yükleyebilir).
export type Template = "blank" | "lined" | "grid" | "dots";

export const TEMPLATES: [Template, string][] = [["lined", "Çizgili"], ["grid", "Kareli"], ["dots", "Noktalı"], ["blank", "Boş"]];
