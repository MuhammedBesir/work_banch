# Çalışma Masası

Üniversite öğrencisinin ders slaytlarını ve kitap PDF'lerini okuyup vurguladığı, not aldığı ve sınav öncesi topladığı, **tamamen tarayıcıda çalışan** bir araç.

> Dosyan bilgisayarından çıkmaz; açma, okuma ve vurgular tamamen bu tarayıcıda işlenir.

Tasarım kararları, renk/şekil sözleşmesi, etkileşim kuralları ve riskler [`docs/`](docs/) altında; tasarım token'larının tek kaynağı [`design/tokens.json`](design/tokens.json).

## Çalıştırma

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm test
```

`npm run build` çıktısı (`dist/`) herhangi bir statik sunucudan yayınlanabilir; sunucu tarafı yoktur. Üretim derlemesine sıkı bir CSP eklenir (üçüncü taraf script ve ağ isteği yok), yazı tipleri pakete gömülüdür.

## v1 kapsamı (bu sürüm)

[`docs/ozellikler.md`](docs/ozellikler.md) ve [`docs/riskler.md`](docs/riskler.md)'deki "ilk sürümde kalmalı" listesi:

- **Oku modu** — sürekli dikey kaydırma; yatay (slayt) PDF'lerde otomatik sayfa sayfa mod (dosya başına hatırlanır). Yalnızca görünen sayfa ±2 çizilir. Genişliğe/Sayfaya sığdır, %50–%400, `Ctrl` + tekerlek imlece çapalı zoom.
- **Vurgu** — metni seç, yüzen çubuktan renk seç ya da `1`–`4`. Dört sabit renk, her biri bir şekille (● ▲ ■ ◆); adlar Ayarlar'dan değişir. Vurgu katmanı canvas'ın üstünde, koyu temadaki `pdf-soften` filtresinin dışında çizilir.
- **Not** — `N` ya da "Not ekle": panelde o satırın not alanı açılır, otomatik kaydedilir, `Ctrl Enter` kapatır.
- **İşaretler paneli** — arama, çoklu renk filtresi, sayfaya göre daraltılabilir gruplar, "Sayfayı takip et", sıralama (sayfa/eklenme/renk), `J`/`K`/`Enter`/`E`/`Delete`, 280–480 px sürüklenebilir genişlik. Panelden vurguya atlama: görünürse yalnızca parlama, ±3 sayfaysa yumuşak kaydırma, daha uzaksa anında.
- **Silme geri alınabilir** — 6 sn "Vurgu silindi · Geri al (`Ctrl Z`)".
- **Arama** (`Ctrl F`) — sonuçlar sayfa numarasıyla listede, `Enter`/`Shift Enter` gezer.
- **İçindekiler ve yer imleri** — sol şeridin ikinci sekmesi; `B` ile sayfaya yer imi.
- **Kaldığın yer** — dosya içerik özetine (SHA-256) bağlı; yeniden açınca son sayfaya döner. Vurgular dosya adına değil içeriğe bağlıdır.
- **Odak modu** (`F`), açık/koyu tema (koyu temada sayfa ters çevrilmez, yumuşatılır; "Orijinal" seçeneği var), arayüz yazı boyutu.
- **Dışa aktar** — Markdown (`<pdf adı>-notlar.md`), renk/düzen/yalnızca-notlu filtreleri ve canlı önizleme. Vurgulu PDF seçeneği Yaz moduyla gelecek; o zamana kadar gizli.
- **Yedek** — Ayarlar'dan JSON yedek / geri yükleme, "Tüm verileri sil" (ikinci onayla). İlk vurguda `navigator.storage.persist()` istenir.
- **Düzenle modu** (`Alt 3`) — sırala (sürükle-bırak ve `Ctrl ↑/↓`), döndür, sil, çoğalt, boş/çizgili/kareli not sayfası ekle, başka PDF ile birleştir, seçili sayfaları ayrı PDF yap. Kayıt her zaman yeni bir kopyaya (pdf-lib, tarayıcıda); vurgular ve yer imleri sayfalarıyla birlikte yeni dosyaya taşınır. İç bağlantı/içindekiler kaybı kaydetmeden önce söylenir.
- **Sınır durumları** — PDF olmayan dosya, bozuk dosya (ayrıntı katlanmış), parola korumalı dosya (parola yalnızca bellekte), çok büyük dosya (300 MB / 1.500 sayfa üstü açmadan önce sorulur), taranmış PDF (okumayı engellemeyen, gizlenebilir uyarı bandı).
- **Son açılanlar** — kaldığın sayfa, vurgu sayısı, son açılış. Chromium'da dosya tutamacı saklanır; diğer tarayıcılarda "Dosyayı yeniden seç" (aynı içerik gelince vurgular geri bağlanır).
- **Duyarlı düzen** — 1100 px altında panel ve şerit çekmeceye döner, hedefler 44 px olur; 720 px altında alta sabit gezinme (Sayfalar · Vurgular · Ara · Diğer) ve alta sabit seçim çubuğu.
- **Erişilebilirlik** — her yerde görünür odak halkası, tam klavye, `aria-live` duyuruları ("Önemli olarak vurgulandı, sayfa 112"), `prefers-reduced-motion`'da parlama yerine 1,5 sn sabit çerçeve. Kısayol listesi: `?`.

### Bilerek bu sürümde yok

Sıralama [`docs/ozellikler.md`](docs/ozellikler.md)'deki gibi: **Yaz modu** ve vurgulu PDF dışa aktarma (v1.1), **Tekrar modu** (v1.1), sayfa notu (v1.1), **AI** (v2), OCR, koyu temada invert, serbest renk, çoklu dosya, hesap/senkronizasyon. Mod seçicide yalnızca Oku ve Düzenle var; AI kapalıyken AI'a dair hiçbir düğme görünmez.

## Yapı

```
design/tokens.json        tasarım token'ları (tek kaynak) → scripts/build-tokens.mjs → src/styles/tokens.css
docs/                     tasarım sistemi, etkileşim, özellik haritası, riskler
src/main.ts               uygulama kabuğu: dosya açma, okuyucu, kısayollar, modlar
src/pdf/viewer.ts         sanallaştırılmış görüntüleyici: canvas + vurgu katmanı + pdf.js metin katmanı
src/pdf/load.ts           pdf.js yükleme, parola, taranmış PDF tespiti, içindekiler
src/editor/               Düzenle modu (ızgara, seçim, sürükle-bırak) ve pdf-lib ile kopya üretimi
src/ui/                   boş durum, panel, şerit, yüzen çubuk, arama, pencereler, bildirimler
src/db.ts                 IndexedDB (dosya kayıtları, vurgular, ayarlar)
src/markdown.ts           Markdown dışa aktarma
src/backup.ts             JSON yedek / geri yükleme
src/styles/components.css tasarım sistemindeki bileşen stilleri (cm-*)
src/styles/app.css        gerçek uygulama düzeni, sayfa katmanları, duyarlı düzen
tests/                    vitest: geometri, Markdown, biçimlendirme, yedek
```
