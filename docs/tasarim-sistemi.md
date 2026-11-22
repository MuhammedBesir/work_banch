Defter, üniversite öğrencisinin ders slaytlarını ve kitap PDF'lerini okuyup vurguladığı, not aldığı ve sınav öncesi topladığı, tamamen tarayıcıda çalışan bir araçtır. Saatlerce bakılacak bir yüzey: her karar okuma alanını öne çıkarmak, arayüzü geri çekmek için verildi.

## İlkeler

**Tek kaynak, tek katman.** Renk, yazı, köşe, gölge ve süre değerleri yalnızca `design/tokens.json`'da; `scripts/build-tokens.mjs` bunları `src/styles/tokens.css`'e yazar. Bileşenler (`cm-btn`, `cm-seg`, `cm-chip`, `cm-menu`, pencere, bant…) `src/styles/components.css`'te bir kez tanımlanır; ekrana özgü düzen `src/styles/app.css`'te. Üstüne binen ikinci bir tema dosyası ve bir bileşeni ezmek için `!important` yok. Görünüm: Apple tarzı sade (nötr gri, sistem yazı tipi, saç teli çizgi, buzlu cam yüzen öğeler).

- **Sayfa baskındır.** 1440px'te okuma alanı ekranın en az %55'idir (sol şerit `rail-width` 120px + sağ panel `panel-width` 344px açıkken). Odak modunda (`F`) araç çubuğu ve paneller tamamen kaybolur.
- **Kâğıt ve mürekkep.** Zemin `paper`, sayfa `sheet`, metin `ink`. Tek vurgu rengi mavi `accent`; ekranda en fazla bir birincil (dolu mavi, `accent-fill`) düğme. Seçili araç ve çip birincil düğmeye benzemez: araç dolu mavi küçük kare, çip koyu dolgu, satır `accent-soft`.
- **Gölge ve cam.** `shadow-sheet` PDF sayfasında ve kartlarda (saç teli çerçeve + çok hafif gölge); `shadow-float` yalnızca yüzen öğelerde (menü, palet, seçim ve biçim çubuğu, pencere, bildirim). Buzlu cam (`glass` + `backdrop-filter`) da yalnızca yüzen öğelerde. Paneller ve üst çubuk gölgesiz; ayrım `line` / `line-strong` saç teliyle.
- **Üst çubuk üç grup.** Solda nereye döneceğin (‹ Kitaplık), sayfa şeridi ve dosya adı, adın altında kayıt durumu. Ortada mod seçici. Sağda sayfa (‹ 12 / 148 ›), yakınlaştırma (%110 ▾: sığdırma ve adımlar menüde), Ara, AI, Dışa aktar, Diğer (⋯: odak modu, tema, yer imi, kaydırma, ses kaydı, Tekrar, Ayarlar, Kısayollar) ve panel. Ses kaydı düğmesi yalnızca kayıt sürerken görünür.
- **Simgeli düğmeye ad.** Yalnız simgeli her düğmede `aria-label` ve ipucu (`title`). Ayar düğmeleri değerini adında taşır: "Yazı yumuşatma: hafif". Seyrek eylemler yazıyla, menüde.
- **Renk tek başına anlam taşımaz.** Her vurgu rengi bir şekille gelir: ● Önemli, ▲ Anlamadım, ■ Sınavda çıkar, ◆ Tanım. Şekil renge bağlıdır, ada değil: kullanıcı adı değiştirse de şekil kalır.
- **Güven mesajı tek cümle.** "Dosyan bilgisayarından çıkmaz; açma, okuma ve vurgular tamamen bu tarayıcıda işlenir." Kalkan ikonu, rozet, "%100 güvenli" yok. Mesajın hemen yanında dürüst uyarı: vurgular bu tarayıcıda saklanır, tarayıcı verisi silinirse gider.

## Üç mod, bir yüzey

- **Oku** (`Alt 1`, varsayılan): seç, vurgula, not al. Bütün önceki kurallar bu mod içindir.
- **Yaz** (`Alt 2`): sayfanın üstüne kalem, metin kutusu, yapışkan not, şekil. Araçlar sayfanın solunda yüzen dar bir palette (`palette-width`); üst bar ve paneller yerinden oynamaz.
- **Düzenle** (`Alt 3`): sayfa ızgarası. Sırala, döndür, sil, çoğalt, not sayfası ekle, birleştir, böl. Kayıt her zaman yeni bir kopyaya.
- Mod seçici üst barda tek bir segment kontrol. Mod değişince yalnızca araçlar değişir; sayfa, zoom ve konum aynı kalır.
- **PDF'in mevcut metni düzenlenmez.** Tarayıcıda güvenilir yapılamaz; düzeltme Yaz modundaki metin kutusuyla yapılır. Bunu arayüzde gizleme, Düzenle modunun yardım metninde tek cümleyle söyle.

### Yaz modu renkleri

- Kalem: `pen-black`, `pen-blue` (varsayılan), `pen-red`. Üçü de yalnızca `sheet` üstünde ve iki temada aynı, çünkü sayfa koyu temada da açık kalır.
- Yapışkan not: `sticky` zemin, `sticky-ink` metin, `note` stiline yakın serif.
- Kalem renkleri vurgu renklerinin yerine geçmez: vurgu bir anlam kategorisi (Önemli, Tanım…), kalem serbest el yazısı. İkisini aynı listede karıştırma; İşaretler paneli türe göre filtreler (Vurgu / Yazı / Çizim).

## AI

- **AI bir mod değil, bir yardımcı.** Sağ panelde İşaretler'in yanında bir sekme (`Ctrl J`) ve seçim araç çubuğunda **Sor** (`A`). Ayrı bir sohbet ekranı yok.
- **Varsayılan kapalı.** İlk açılışta bir kez sorulur: Bu cihazda (varsayılan seçim) / Kendi API anahtarınla / Kapalı. Kapalıyken AI'ya dair hiçbir düğme görünmez.
- **Gönderilen her şey görünür.** Bulut modunda Sor düğmesinin altında "Gönderilecek: sayfa 112 metni · 1.240 karakter" yazar (`warning`). Dosyanın tamamı asla kendiliğinden gönderilmez.
- **Her cevap kaynağa bağlı.** İddialar sayfa etiketiyle (`cm-src`) gelir; etikete gelince sayfadaki dayanak metin `ai-cite` noktalı alt çizgiyle gösterilir. Kaynağı olmayan cümle soluk.
- **AI görsel olarak sıradan.** Mor gradyan, parıltı, yıldız ikonu, "sihirli" dil yok. Mod rozeti yalnızca nerede çalıştığını söyler: cihazda (yeşil daire), bulut (turuncu kare).
- **AI çıktısı kullanıcının verisine onaysız girmez.** Not olarak ekle, kart yap: hepsi açık bir tıkla ve "AI" etiketiyle.

## Dil ve metin

- Arayüz Türkçe, ikinci tekil şahıs, kısa: "PDF'ini buraya bırak", "Dosyayı yeniden seç". "Lütfen", "Hata oluştu!" ve ünlem yok.
- Hata mesajı iki parçadır: ne oldu + ne yapabilirsin. "Bu dosya açılamadı. … Dosyayı tekrar indirip yeniden dene."
- Sayılar Türkçe biçimde: `1.840 sayfa`, `18,4 MB`, `%68`. Sayfa numaraları ve kısayollar `num` stiliyle (mono, hizalı rakam).
- Emoji yok, süs ikonu yok. Simge yalnızca sık kullanılan, tanınmış eylemlerde (ara, geri, panel, araçlar) ve her zaman adıyla (ipucu + ekran okuyucu); seyrek eylemler yazıyla.

## Renk

- Zeminler: uygulama `paper`, paneller ve üst bar `surface`, yüzen öğeler ve pencereler `surface-raised`, PDF `sheet`.
- Metin: `ink` ana metin, `ink-muted` ikincil. İkisi de `paper`, `surface`, `surface-raised` üstünde her iki temada 4.5:1 üzeri (en düşük `ink-muted` koyu `surface-raised` üstünde 5.8:1).
- Kontroller: girdi ve ikincil buton kenarı `control-border` (3:1 üzeri). `line` sadece dekoratif ayraçtır, kontrol kenarı olarak kullanma.
- Birincil eylem `accent-fill` zemin + beyaz metin; koyu temada `accent-fill` ayrı bir ton (#0071e3) olduğu için beyaz yazı orada da AA. `accent` (koyuda açık mavi) yalnızca bağlantı, seçili satır işareti ve odak için; üstüne beyaz yazılmaz.
- Durum: `danger`/`danger-soft` bozuk dosya ve silme; `warning`/`warning-soft` taranmış PDF ve büyük dosya. Başarı rengi yok, gerek yok: başarı = içeriğin görünmesi.

### Vurgu renkleri

| # | Varsayılan ad | Dolgu | İşaret | Şekil |
|---|---|---|---|---|
| 1 | Önemli | `hl-1` | `hl-1-mark` | daire |
| 2 | Anlamadım | `hl-2` | `hl-2-mark` | üçgen |
| 3 | Sınavda çıkar | `hl-3` | `hl-3-mark` | kare |
| 4 | Tanım | `hl-4` | `hl-4-mark` | eşkenar dörtgen |

- Dolgu (`hl-n`) yalnızca `sheet` üstünde, metnin arkasında kullanılır; üstündeki `sheet-ink` her temada 6.8:1 üzeri.
- Panel ve çiplerdeki şekil `hl-n-mark` (surface üstünde 4.6:1 üzeri). PDF sayfası ve küçük sayfa önizlemesi üstündeki şekil `sheet-mark-n` — çünkü koyu temada da sayfa açık renkte kalır.
- Dört dolgu açıklıkta birbirine yakındır (göreli parlaklık 0.47–0.69). Bu bilinçli: hepsi siyah metnin okunacağı kadar açık olmak zorunda. Ayırt etmeyi şekil ve sıra numarası taşır; bu yüzden şekli hiçbir ekranda kaldırma.
- Renkler kullanıcı tarafından değiştirilemez, yalnızca adlandırılır. Serbest renk seçimi kontrast ve renk körlüğü garantisini bozar.

### Koyu tema ve PDF sayfası

Varsayılan: **yumuşat**. PDF canvas katmanına `pdf-soften` filtresi (`brightness(0.85) sepia(0.1)`) uygulanır; beyaz sayfa `sheet` koyu değerine (#d9d4c9 civarı) iner, siyah metin siyah kalır. Vurgu katmanı filtrenin DIŞINDA, canvas'ın üstünde ayrı bir katmanda çizilir, böylece `hl-n` koyu tema değerleri olduğu gibi görünür.

**Ters çevirme (invert) ilk sürümde yok.** Grafikleri, fotoğrafları ve renkli slaytları bozar; ayrıca vurgu paletinin üçüncü bir setini gerektirir. Ayarlarda yalnızca "Yumuşat / Orijinal" (`pdf-original`) var.

## Tipografi

**Arayüz sistem yazı tipinde** (`font-sans`: SF Pro, Segoe UI, Inter): her platformda yerel, indirme yok. Başlıklar `font-display` (SF Pro Display), harf aralığı −0,022em. **Kullanıcı notu serif** (`font-serif`: New York, Source Serif 4, Georgia): not, kitap kenarına yazılmış gibi arayüzden ayrışır. Rakamlar `font-variant-numeric: tabular-nums`; kod ve sayfa giriş kutusu dışında makine yazısı (mono) yok.

- Ölçek: display 34/40 (yalnızca Kitaplık başlığı) · title 22/28 · pencere başlığı 19/24 · headline 17/22 · gövde 14/20 · açıklama 13/18 · küçük 12/16 · etiket 11/16 büyük harf.
- Kullanıcı notu her yerde serif 15/23.
- Ayarlar'daki "Büyük" yazı boyutu bütün arayüzü ölçekler; PDF bundan etkilenmez.

## Boşluk, köşe, boyut

- 4px tabanlı: `space-1` 4 … `space-12` 48. Panel kenarı `space-4`, pencere içi `space-6`, PDF sayfaları arası `space-6`.
- Köşeler: `radius-sm` 6 (düğme, girdi), `radius-md` 10 (seçenek, menü öğesi), `radius-lg` 14 (kart, liste kutusu, palet), `radius-xl` 20 (pencere), `radius-pill` (filtre çipi, bildirim).
- Üst bar `toolbar-height` 52px (dosya adının altında kayıt durumu sığsın diye). Tıklama hedefi masaüstünde en az `target-min` 32px, dokunmatikte `target-touch` 44px.

## Erişilebilirlik

- Odak halkası: `focus` renginde 2px düz çizgi, 2px boşluk; her yüzeyde 3:1 üzeri. `outline: none` yasak.
- Tam klavye: `Tab` sırası üst bar → sol şerit → sayfa → sağ panel. Sayfa içinde `J`/`K` veya `←`/`→` sayfa, `G` sayfaya git, `Ctrl F` ara, `F` odak modu, `[` / `]` sol/sağ panel, `Ctrl +`/`−` zoom, `?` kısayol listesi.
- Seçim varken `1`–`4` renk, `N` not, `C` kopyala, `Esc` kapat. Tek harfli kısayollar bir girdi alanı odaktayken çalışmaz.
- Panel öğeleri `role="listitem"`, `Enter` ile sayfadaki vurguya atlar; yeni vurgu eklendiğinde `aria-live="polite"` ile "Önemli olarak vurgulandı, sayfa 112" duyurulur.
- `prefers-reduced-motion`: kaydırma animasyonu ve parlama kapanır, yerine 1,5 sn sabit odak çerçevesi.
