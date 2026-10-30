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

`npm run build` çıktısı (`dist/`) herhangi bir statik sunucudan yayınlanabilir; sunucu tarafı yoktur. Üretim derlemesine sıkı bir CSP eklenir (üçüncü taraf script yok; tek dış bağlantı, AI açıksa Anthropic API), yazı tipleri pakete gömülüdür.

## Oku modu ve v1 kapsamı

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

## Yaz modu (v1.1)

`Alt 2` ya da üst bardaki mod seçici. Araçlar sayfanın solunda yüzen dar bir palette; üst bar ve paneller yerinden oynamaz.

- **Araçlar:** Seç `V`, Vurgu `H` (Oku modundaki metin seçimi), Kalem `P`, Metin kutusu `T`, Yapışkan not `S`, Şekil `R` (dikdörtgen, daire, ok), Silgi `E`. Kalem rengi `Shift 1–3` (siyah, mavi, düzeltme kırmızısı), üç kalınlık. `Ctrl Z` / `Ctrl Shift Z` her işlem için; `Esc` Oku moduna döner.
- **Çizimler vektör:** sayfaya göre 0–1 koordinatlarla SVG olarak saklanır, zoom'da bozulmaz. Kalemle (stylus) çizerken ortalama basınç çizgi kalınlığına yansır.
- **Avuç reddi:** parmak dokunuşu Yaz modunda da yalnızca sayfayı kaydırır; fare ve kalem çizer.
- **Silgi** bütün çizgiyi siler (kısmi silme yok). **Seç** aracıyla işaretler sürüklenerek taşınır, `Del` ile silinir; metin kutusu ve nota çift tıklayınca düzenlenir. Boş kalan metin kutusu kendiliğinden silinir. Yapışkan not 16 px'lik köşe işaretine daraltılabilir.
- **İşaretler paneli** türe göre filtreler (Vurgu / Yazı / Çizim). Kalem çizimleri sayfa başına tek satırdır; el yazısı aranamaz, panel bunu açıkça yazar.
- Metin kutuları ve notlar **Markdown dışa aktarmaya** girer (isteğe bağlı); tüm işaretler **JSON yedeğe** girer ve **Düzenle modunda** kaydedilen kopyaya sayfalarıyla (döndürmeyle birlikte) taşınır.

## AI yardımcısı (v2, kendi API anahtarınla)

Varsayılan **kapalı**; kapalıyken AI'a dair hiçbir düğme görünmez. Ayarlar > AI > "AI'yı aç…" ile Anthropic API anahtarını gir ve modeli seç (Claude Opus 5.5 varsayılan; Sonnet 5.5 ve Haiku 5.5 seçilebilir).

- **Sağ panelde bir sekme** (`Ctrl J`), ayrı bir sohbet ekranı değil. Seçim varken yüzen çubukta **Sor** (`A`) seçili metni kapsam yaparak paneli açar.
- **Kapsam her istekte görünür:** Seçim / Bu sayfa / Bölüm (içindekiler ağacından) / Vurgularım. Sor düğmesinin hemen altında "Gönderilecek: sayfa 112 metni · 1.240 karakter" yazar; "Göster" ile metnin tamamı açılır ve göndermeden kırpılabilir. Dosyanın tamamı asla kendiliğinden gönderilmez; arka planda hiçbir istek yapılmaz. Çok uzun bölüm kırpılmaz, daha dar kapsam seçmen söylenir.
- **Hızlı istekler:** Bu sayfayı özetle, Anlamadıklarımı açıkla (2. renk vurgularından), Sınav sorusu üret, Tanımları açıkla (4. renk vurgularından).
- **Her cevap kaynağa bağlı:** iddialar sayfa etiketiyle gelir; etikete gelince dayandığı metin sayfada `ai-cite` noktalı alt çizgiyle gösterilir, tıklayınca o yere atlar. Kaynağı olmayan cümleler soluk.
- **AI çıktısı onaysız girmez:** "Not olarak ekle" cevabı sayfaya "AI notu" etiketli yapışkan not olarak ekler (geri alınabilir). Kopyala, Yeniden üret; `Esc` akışı durdurur.
- **Hatalar** (geçersiz anahtar, sınır/kredi, bağlantı) "ne oldu + ne yapabilirsin" biçiminde panelde görünür, okumayı engellemez.
- **Teknik:** istek tarayıcıdan doğrudan `api.anthropic.com`'a resmi `@anthropic-ai/sdk` ile gider (arada sunucu yok); SDK ayrı bir parça olarak yalnızca ilk soruda yüklenir. Opus 5.5 ve Sonnet 5.5'te reddedilen istek için sunucu tarafı yedek model (`fallbacks: "default"`) açıktır. Anahtar yalnızca bu tarayıcıda (IndexedDB) saklanır, **JSON yedeğe girmez**, Ayarlar'dan silinir. Üretim CSP'si dışarıya yalnızca `https://api.anthropic.com` bağlantısına izin verir. Düşük harcama sınırlı bir anahtar kullanman önerilir.

### Bilerek bu sürümde yok

Sıralama [`docs/ozellikler.md`](docs/ozellikler.md)'deki gibi: **cihazda çalışan model** (WebGPU, ~1,5 GB indirme) ve OCR, vurgulu/işaretli PDF dışa aktarma, **Tekrar modu**, sayfa notu, koyu temada invert, serbest renk, çoklu dosya, hesap/senkronizasyon.

## Yapı

```
design/tokens.json        tasarım token'ları (tek kaynak) → scripts/build-tokens.mjs → src/styles/tokens.css
docs/                     tasarım sistemi, etkileşim, özellik haritası, riskler
src/main.ts               uygulama kabuğu: dosya açma, okuyucu, kısayollar, modlar
src/pdf/viewer.ts         sanallaştırılmış görüntüleyici: canvas + vurgu katmanı + pdf.js metin katmanı
src/pdf/load.ts           pdf.js yükleme, parola, taranmış PDF tespiti, içindekiler
src/editor/               Düzenle modu (ızgara, seçim, sürükle-bırak) ve pdf-lib ile kopya üretimi
src/write/                Yaz modu: palet ve işaretçi (writeMode), vektör katman (layer), geometri
src/ai/                   AI: istem, kapsam ve kaynak etiketleri (prompt), Claude API istemcisi (client)
src/ui/                   boş durum, panel, AI paneli, şerit, yüzen çubuk, arama, pencereler, bildirimler
src/db.ts                 IndexedDB (dosya kayıtları, vurgular, ayarlar)
src/markdown.ts           Markdown dışa aktarma
src/backup.ts             JSON yedek / geri yükleme
src/styles/components.css tasarım sistemindeki bileşen stilleri (cm-*)
src/styles/app.css        gerçek uygulama düzeni, sayfa katmanları, duyarlı düzen
tests/                    vitest: geometri, Yaz modu geometrisi, AI kaynak ayrıştırma, Markdown, biçimlendirme, yedek
```
