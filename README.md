# Çalışma Masası

Üniversite öğrencisinin ders slaytlarını ve kitap PDF'lerini okuyup vurguladığı, not aldığı ve sınav öncesi topladığı, **tamamen tarayıcıda çalışan** bir araç.

> Dosyan bilgisayarından çıkmaz; açma, okuma ve vurgular tamamen bu tarayıcıda işlenir.

**Canlı:** https://calisma-masasi-cyan.vercel.app — `main` branch'ine her push Vercel'de otomatik yayınlanır; diğer branch'ler önizleme adresi alır.

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

Uçtan uca testler (Playwright; ilk seferde tarayıcıları indir):

```bash
npx playwright install
```

```bash
npm run e2e
```

Tek tarayıcı için `npx playwright test --project=chromium` (projeler: `chromium`, `firefox`, `webkit`, `ipad`). GitHub Actions her push'ta birim testleri ve dört tarayıcıyı da çalıştırır.

`npm run build` çıktısı (`dist/`) herhangi bir statik sunucudan yayınlanabilir; sunucu tarafı yoktur. Üretim derlemesine sıkı bir CSP eklenir (üçüncü taraf script yok; dış bağlantılar yalnızca seçilen AI sağlayıcısına ve cihazda model indirmeye), yazı tipleri ve OCR verisi pakete gömülüdür. Uygulama yüklenebilir (PWA) ve çevrimdışı açılır.

## Oku modu ve v1 kapsamı

[`docs/ozellikler.md`](docs/ozellikler.md) ve [`docs/riskler.md`](docs/riskler.md)'deki "ilk sürümde kalmalı" listesi:

- **Oku modu** — sürekli dikey kaydırma; yatay (slayt) PDF'lerde otomatik sayfa sayfa mod (dosya başına hatırlanır). Yalnızca görünen sayfa ±2 çizilir. Genişliğe/Sayfaya sığdır, %50–%400, `Ctrl` + tekerlek imlece çapalı zoom.
- **Vurgu** — metni seç, yüzen çubuktan renk seç ya da `1`–`4`. Dört sabit renk, her biri bir şekille (● ▲ ■ ◆); adlar Ayarlar'dan değişir. Vurgu katmanı canvas'ın üstünde, koyu temadaki `pdf-soften` filtresinin dışında çizilir.
- **Not** — `N` ya da "Not ekle": panelde o satırın not alanı açılır, otomatik kaydedilir, `Ctrl Enter` kapatır.
- **İşaretler paneli** — arama, çoklu renk filtresi, sayfaya göre daraltılabilir gruplar, "Sayfayı takip et", sıralama (sayfa/eklenme/renk), `J`/`K`/`Enter`/`E`/`Delete`, 280–480 px sürüklenebilir genişlik. Panelden vurguya atlama: görünürse yalnızca parlama, ±3 sayfaysa yumuşak kaydırma, daha uzaksa anında.
- **Silme geri alınabilir** — 6 sn "Vurgu silindi · Geri al (`Ctrl Z`)".
- **Arama** (`Ctrl F`) — sonuçlar sayfa numarasıyla listede, `Enter`/`Shift Enter` gezer; sayfadaki bütün eşleşmeler soluk, geçerli olan belirgin.
- **Sayfalar arası vurgu** — iki sayfaya taşan seçim tek vurgu olur (panelde "s. 3–4").
- **Sayfa notu** (`Shift N`) — metne bağlı olmayan, sayfaya yapışan not; taranmış sayfalarda da çalışır.
- **Tarayıcıda OCR** — metni olmayan (taranmış) sayfalar bu cihazda tanınır (tesseract.js, Türkçe + İngilizce, ~5 MB veri ilk kullanımda kendi sunucumuzdan iner). Sonuç dosya başına saklanır; sonra o sayfada seçim, vurgu, arama ve AI çalışır.
- **Dokunmatik** — sayfa sayfa modda yatay kaydırma sonraki/önceki sayfaya geçer.
- **İçindekiler ve yer imleri** — sol şeridin ikinci sekmesi; `B` ile sayfaya yer imi.
- **Kaldığın yer** — dosya içerik özetine (SHA-256) bağlı; yeniden açınca son sayfaya döner. Vurgular dosya adına değil içeriğe bağlıdır.
- **Odak modu** (`F`), açık/koyu tema (koyu temada sayfa ters çevrilmez, yumuşatılır; "Orijinal" seçeneği var), arayüz yazı boyutu.
- **Dışa aktar** — Markdown (`<pdf adı>-notlar.md`), renk/düzen/yalnızca-notlu filtreleri ve canlı önizleme. **Vurgulu PDF**: varsayılan "yassı" (vurgular, çizimler ve metin kutuları sayfaya basılır, her okuyucuda aynı görünür) ya da "düzenlenebilir" (gerçek PDF açıklamaları: Highlight, Ink, Square, Circle, Text).
- **Yedek** — Ayarlar'dan JSON yedek / geri yükleme, "Tüm verileri sil" (ikinci onayla). İlk vurguda `navigator.storage.persist()` istenir.
- **Düzenle modu** (`Alt 3`) — sırala (sürükle-bırak ve `Ctrl ↑/↓`), döndür, sil, çoğalt, boş/çizgili/kareli not sayfası ekle, başka PDF ile birleştir, seçili sayfaları ayrı PDF yap. Kayıt her zaman yeni bir kopyaya (pdf-lib, tarayıcıda); vurgular ve yer imleri sayfalarıyla birlikte yeni dosyaya taşınır. İç bağlantı/içindekiler kaybı kaydetmeden önce söylenir.
- **Sınır durumları** — PDF olmayan dosya, bozuk dosya (ayrıntı katlanmış), parola korumalı dosya (parola yalnızca bellekte), çok büyük dosya (300 MB / 1.500 sayfa üstü açmadan önce sorulur), taranmış PDF (okumayı engellemeyen, gizlenebilir uyarı bandı; "Metni tanıt (OCR)" ve "Sayfaya not ekle").
- **Son açılanlar** — kaldığın sayfa, vurgu sayısı, son açılış. Chromium'da dosya tutamacı saklanır; Firefox ve Safari'de dosyanın bir kopyası tarayıcının özel deposunda (OPFS, en fazla 200 MB) tutulur ve tek tıkla açılır. Aynı içerik farklı adla açılınca tanınır ("aynı dosya, önceki adı …").
- **Düzenle modunda** ayrıca kırpma ve not alanı (kenar boşluğu); birleştirilen PDF'in vurguları ve içindekiler ağacı yeni dosyaya taşınır.
- **Duyarlı düzen** — 1100 px altında panel ve şerit çekmeceye döner, hedefler 44 px olur; 720 px altında alta sabit gezinme (Sayfalar · Vurgular · Ara · Diğer) ve alta sabit seçim çubuğu.
- **Erişilebilirlik** — her yerde görünür odak halkası, tam klavye, `aria-live` duyuruları ("Önemli olarak vurgulandı, sayfa 112"), `prefers-reduced-motion`'da parlama yerine 1,5 sn sabit çerçeve. Kısayol listesi: `?`. axe-core ile WCAG 2.1 AA otomatik denetimi e2e testlerinin parçası (giriş, okuyucu, koyu tema, diyaloglar, Yaz ve Tekrar modu, telefon genişliği).
- **Yedek hatırlatma** — 7 günde bir, vurgu varsa ve yedek alınmadıysa kısa bir bant (3 gün ertelenebilir).
- **Hata günlüğü** — isteğe bağlı (Ayarlar), yalnızca bu cihazda; dosya adı ve içerik içermez, JSON olarak indirilebilir.

## Yaz modu (v1.1)

`Alt 2` ya da üst bardaki mod seçici. Araçlar sayfanın solunda yüzen dar bir palette; üst bar ve paneller yerinden oynamaz.

- **Araçlar:** Seç `V`, Vurgu `H` (Oku modundaki metin seçimi), Kalem `P`, Metin kutusu `T`, Yapışkan not `S`, Şekil `R` (dikdörtgen, daire, ok), Silgi `E`. Kalem rengi `Shift 1–3` (siyah, mavi, düzeltme kırmızısı), üç kalınlık. `Ctrl Z` / `Ctrl Shift Z` her işlem için; `Esc` Oku moduna döner.
- **Çizimler vektör:** sayfaya göre 0–1 koordinatlarla SVG olarak saklanır, zoom'da bozulmaz. Kalemle (stylus) çizerken basınç çizgi boyunca kalınlığa yansır. `Shift` ile düz çizgi / kare / daire; `Shift`-tık ile çoklu seçim; metin kutusunun sağ kenarındaki tutamaçla genişlik değişir. Çizimler sol şeritteki küçük sayfalarda da görünür. Telefonda palet alta yatay yerleşir.
- **Avuç reddi:** parmak dokunuşu Yaz modunda da yalnızca sayfayı kaydırır; fare ve kalem çizer.
- **Silgi** bütün çizgiyi siler (kısmi silme yok). **Seç** aracıyla işaretler sürüklenerek taşınır, `Del` ile silinir; metin kutusu ve nota çift tıklayınca düzenlenir. Boş kalan metin kutusu kendiliğinden silinir. Yapışkan not 16 px'lik köşe işaretine daraltılabilir.
- **İşaretler paneli** türe göre filtreler (Vurgu / Yazı / Çizim). Kalem çizimleri sayfa başına tek satırdır; el yazısı aranamaz, panel bunu açıkça yazar.
- Metin kutuları ve notlar **Markdown dışa aktarmaya** girer (isteğe bağlı); tüm işaretler **JSON yedeğe** girer ve **Düzenle modunda** kaydedilen kopyaya sayfalarıyla (döndürmeyle birlikte) taşınır.

## Samsung Notes'tan esinlenen not araçları

- **Kalem türleri:** tükenmez, kurşun kalem, fosforlu (yarı saydam), dolma kalem (açılı uç, yöne göre kalınlık). Üç hazır renk + 12 özel ton ve renk seçici; son kullanılan özel renkler palette kalır.
- **Kısmi silgi** (çizginin değdiği kısmı siler) ya da **bütün çizgi**. Kalemin yan tuşu ya da silgi ucu basılıyken geçici silgi.
- **Taşıma:** Seç aracında (`V`) işarete basıp sürükle; parmakla da olur. Herhangi bir araçta bir yazının ya da şeklin üstünde kıpırdamadan basılı tutunca (~0,5 sn) seçilir. Metin aracında var olan kutuyu sürükleyince taşınır, tıklayınca düzenlenir.
- **Kement** (`L`): çizerek seç; seçim kutusunun köşesinden **boyutlandır** (`Shift` oranı korur), sürükleyerek taşı, **renk değiştir**, çoğalt, sil.
- **Çiz ve bekle:** kalemi bir an yerinde tutunca düz çizgi, üçgen, dörtgen, dikdörtgen ve elips düzeltilir.
- **El yazısını düzleştir**, **metne çevir** ve **matematiği çöz** (kement çubuğundan): bu cihazda (OCR) ya da görsel destekleyen AI ile (Claude, OpenAI; yalnızca seçimin görseli gider).
- **El yazısında arama:** Dosya menüsü › El yazısını tanı. Tanınan yazı sayfanın metin katmanına eklenir; Ctrl F, panel araması ve AI kapsamı görür. Yaz modundan çıkınca değişen sayfalar kendiliğinden yeniden tanınır.
- **Resim** (`I` ya da `Ctrl V`): sayfaya eklenir, boyutlandırılır; PDF, Word ve PowerPoint dışa aktarmaya girer.
- **Biçimli not:** metin kutusu ve yapışkan notta kalın, italik, altı/üstü çizili, madde, sıralı liste, **yapılacak** (tıklanabilir), başlık ve **tablo**; düzenlerken yazım denetimi.
- **Ses kaydı** (`Alt R`): ders sırasında kayıt; o sırada eklenen vurgu ve işaretler kaydın o anına bağlanır, panelde `▶ dk:sn` ile o andan dinlenir, çalarken sonraki işaretler soluklaşır. Yazıya dökme: kayıt sırasında tarayıcının konuşma tanımasıyla (isteğe bağlı; Chrome'da ses Google'a gider) ya da sonradan OpenAI anahtarıyla. AI ile ders özeti. Kayıtlar yalnızca bu tarayıcıda saklanır, JSON yedeğe girmez.
- **Not defteri:** boş, çizgili, kareli ya da noktalı; en altta **+ Sona sayfa ekle** (sonsuz defter gibi, işaretler yeni sürüme taşınır).
- **Son açılanlar:** klasörler, etiketler, başa sabitleme, arama, **kapak görünümü** (ilk sayfa ya da renk), **not kilidi** (PIN; veri şifrelenmez, açılmayı ve önizlemeyi engeller).
- **Dışa aktarma:** Word (.docx, renkli vurgular ve notlar), PowerPoint (.pptx, her sayfa bir slayt, notlar konuşmacı notunda), sayfa resmi (.png) ve bütün sayfalar (.zip).
- **Paylaşma ve eşitleme (sunucusuz):** *Paylaşım paketi* PDF'i ve bütün işaretleri tek dosyada taşır, alan kişi "Paylaşım paketi aç" ile açar. Chromium'da *otomatik yedek klasörü* seçilebilir; OneDrive / Google Drive / iCloud klasörü seçilirse yedek diğer cihazlara da gider.
- **AI:** "Notlarımı düzenle" (vurgu, not ve el yazısından düzenli çalışma notu) ve "Bu sayfayı çevir".

Bilerek yok: gerçek zamanlı ortak düzenleme ve hesapla bulut eşitleme (sunucu ve hesap gerektirir; uygulama bilerek sunucusuz).

## Tekrar modu

`Alt T` ya da Dışa aktar menüsü. Vurgulardan otomatik kartlar (vurgu ön yüz, notun arka yüz), basitleştirilmiş aralıklı tekrar (Tekrar et / Zor / Kolay; `Space` çevir, `1`–`3` puan). AI açıksa "Kart öner" tanımlardan kart önerir; öneriler onaylanmadan desteye girmez.

## AI yardımcısı (v2)

Varsayılan **kapalı**; kapalıyken AI'a dair hiçbir düğme görünmez. Ayarlar > AI > "AI'yı aç…" ile bir sağlayıcı seç:

- **Bu cihazda** (WebGPU, WebLLM): hiçbir şey dışarı gitmez; ilk kullanımda model indirilir (~1–2 GB).
- **Yerel sunucu** (Ollama / LM Studio, OpenAI uyumlu `localhost` adresi).
- **Anthropic** (Claude Opus 5.5 varsayılan; Sonnet 5.5, Haiku 5.5), **Google Gemini** ya da **OpenAI**, kendi API anahtarınla. Gemini'de model listesi anahtarla API'den yüklenir (varsayılan `gemini-flash-latest` takma adı); Gemini ses kaydını da yazıya döker ve el yazısını görselden okur. İstekler tarayıcıdan doğrudan sağlayıcıya gider.

Sohbet geçmişi dosya başına saklanır, Markdown olarak dışa aktarılır; her cevabın altında token sayısı ve tahmini ücret görünür. "Kaynakları vurgula" cevabın dayandığı yerleri seçtiğin renkle vurgular.

- **Sağ panelde bir sekme** (`Ctrl J`), ayrı bir sohbet ekranı değil. Seçim varken yüzen çubukta **Sor** (`A`) seçili metni kapsam yaparak paneli açar.
- **Kapsam her istekte görünür:** Seçim / Bu sayfa / Bölüm (içindekiler ağacından) / Vurgularım. Sor düğmesinin hemen altında "Gönderilecek: sayfa 112 metni · 1.240 karakter" yazar; "Göster" ile metnin tamamı açılır ve göndermeden kırpılabilir. Dosyanın tamamı asla kendiliğinden gönderilmez; arka planda hiçbir istek yapılmaz. Çok uzun bölüm kırpılmaz, daha dar kapsam seçmen söylenir.
- **Hızlı istekler:** Bu sayfayı özetle, Anlamadıklarımı açıkla (2. renk vurgularından), Sınav sorusu üret, Tanımları açıkla (4. renk vurgularından).
- **Her cevap kaynağa bağlı:** iddialar sayfa etiketiyle gelir; etikete gelince dayandığı metin sayfada `ai-cite` noktalı alt çizgiyle gösterilir, tıklayınca o yere atlar. Kaynağı olmayan cümleler soluk.
- **AI çıktısı onaysız girmez:** "Not olarak ekle" cevabı sayfaya "AI notu" etiketli yapışkan not olarak ekler (geri alınabilir). Kopyala, Yeniden üret; `Esc` akışı durdurur.
- **Hatalar** (geçersiz anahtar, sınır/kredi, bağlantı) "ne oldu + ne yapabilirsin" biçiminde panelde görünür, okumayı engellemez.
- **Teknik:** istek tarayıcıdan doğrudan `api.anthropic.com`'a resmi `@anthropic-ai/sdk` ile gider (arada sunucu yok); SDK ayrı bir parça olarak yalnızca ilk soruda yüklenir. Opus 5.5 ve Sonnet 5.5'te reddedilen istek için sunucu tarafı yedek model (`fallbacks: "default"`) açıktır. Anahtar yalnızca bu tarayıcıda (IndexedDB) saklanır, **JSON yedeğe girmez**, Ayarlar'dan silinir. Üretim CSP'si dışarıya yalnızca `https://api.anthropic.com` bağlantısına izin verir. Düşük harcama sınırlı bir anahtar kullanman önerilir.

### Bilerek bu sürümde yok

Koyu temada invert, serbest renk, aynı anda çoklu dosya, hesap/senkronizasyon.

## Yapı

```
design/tokens.json        tasarım token'ları (tek kaynak) → scripts/build-tokens.mjs → src/styles/tokens.css
docs/                     tasarım sistemi, etkileşim, özellik haritası, riskler
src/main.ts               uygulama kabuğu: dosya açma, okuyucu, kısayollar, modlar
src/pdf/viewer.ts         sanallaştırılmış görüntüleyici: canvas + vurgu katmanı + pdf.js metin katmanı
src/pdf/load.ts           pdf.js yükleme, parola, taranmış PDF tespiti, içindekiler
src/editor/               Düzenle modu (ızgara, seçim, sürükle-bırak) ve pdf-lib ile kopya üretimi
src/write/                Yaz modu: palet ve işaretçi (writeMode), vektör katman (layer), geometri (şekil tanıma, kısmi silgi, kement),
                          biçimli not (rich), renkler, el yazısı görüntüsü (raster)
src/ai/                   AI: istem, kapsam ve kaynak etiketleri (prompt), sağlayıcılar (anthropic, openai, device) ve dağıtıcı (client)
src/review/               Tekrar modu: aralıklı tekrar (srs) ve ekran
src/export/pdf.ts         vurgulu / işaretli PDF (yassı ya da açıklama)
src/ocr/ocr.ts            tarayıcıda OCR ve OCR metin katmanı
src/app/                  PWA, OPFS kopyaları, yedek hatırlatma, hata günlüğü, not kilidi
src/audio/                ses kaydı, oynatıcı çubuğu, yazıya dökme ve özet penceresi
src/export/office.ts      Word, PowerPoint, PNG / ZIP dışa aktarma (docx, pptxgenjs, jszip; ayrı parçalar)
src/editor/notebook.ts    boş not defteri ve sona sayfa ekleme
src/ui/                   boş durum, panel, AI paneli, şerit, yüzen çubuk, arama, pencereler, bildirimler
src/db.ts                 IndexedDB (dosyalar, vurgular, Yaz modu işaretleri, kartlar, ayarlar ve meta)
src/markdown.ts           Markdown dışa aktarma
src/backup.ts             JSON yedek / geri yükleme
src/styles/components.css tasarım sistemindeki bileşen stilleri (cm-*)
src/styles/app.css        gerçek uygulama düzeni, sayfa katmanları, duyarlı düzen
tests/                    vitest: geometri, Yaz modu, AI, Markdown, biçimlendirme, yedek, tekrar, Düzenle modu dönüşümleri
e2e/                      Playwright: okuma, Yaz, Tekrar, OCR ve axe erişilebilirlik denetimi (4 tarayıcı projesi)
scripts/                  token üretimi, OCR verisini kopyalama, service worker şablonu
```
