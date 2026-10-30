# Etkileşim

## Vurgu yapma akışı

1. Fareyle metni sürükleyerek seç.
2. Fare bırakıldıktan 100 ms sonra yüzen araç çubuğu seçimin 8px üstünde açılır (üstte yer yoksa altında). Açılış: 120 ms opaklık + 4px yukarı kayma.
3. Rengi tıkla (ya da `1`–`4`). Seçim anında vurguya döner; panelde satır, sayfadaki yerine göre doğru sıraya eklenir ve 600 ms `accent-soft` zeminle belirir.
4. Araç çubuğu "uygulandı" haline geçer (seçili renk çerçeveli + Not ekle / Kopyala / Sil); 2 sn hareketsiz kalırsa ya da başka yere tıklanırsa kapanır.

**Maliyet:** 1 sürükleme + 1 tık, yaklaşık 1,5–2 sn. Klavyeyle 0 tık (seç + `2`). Not eklemek: `N` ya da "Not ekle" → panelde o satırın not alanı odaklı açılır, sayfa yerinden oynamaz. Not otomatik kaydedilir; `Ctrl Enter` kapatır.

Mevcut vurguya tıklamak aynı araç çubuğunu "uygulandı" halinde açar: renk değiştir, not ekle, sil. Silme geri alınabilir: 6 sn "Vurgu silindi · Geri al (`Ctrl Z`)" bildirimi.

## Panelden vurguya atlama

- Hedef görünür alandaysa: kaydırma yok, yalnızca parlama.
- Hedef ±3 sayfa içindeyse: 240 ms ease-out yumuşak kaydırma; vurgu ekranın üst üçte birine yerleşir.
- Daha uzaktaysa: animasyonsuz anında atlama. 80 sayfa boyunca animasyonla kaydırmak hem yavaş hem baş döndürücü.
- Varışta parlama (`is-flash`): vurgunun çevresinde `focus` renginde 2px çerçeve 6px'ten 1px'e daralır ve 900 ms içinde söner. Tek sefer; yanıp sönme yok.
- Panelde ilgili satır seçili kalır (`accent-soft`), böylece kullanıcı listede nerede olduğunu kaybetmez.

## Zoom ve kaydırma

- Varsayılan **sürekli dikey kaydırma**: kitap ve ders notu okumanın doğal hali.
- Yatay (slayt) oranlı PDF'lerde otomatik **sayfa sayfa** mod: "Sayfaya sığdır", `PageDown` / `Space` bir slayt ilerletir, tekerlek kaydırması sayfaya yapışır. Üst bardan değiştirilebilir, dosya başına hatırlanır.
- Zoom ön ayarları: Genişliğe sığdır (varsayılan), Sayfaya sığdır, %50–%400. `Ctrl` + tekerlek imleç noktasına çapalı yakınlaştırır; butonlar ve `Ctrl +`/`−` ekran ortasına çapalıdır. Zoom sırasında okunan satır yerinde kalır.
- Yalnızca görünen sayfa ±2 sayfa çizilir; diğerleri doğru boyutlu boş yer tutucudur (kaydırma çubuğu zıplamaz).
- Sayfa göstergesi (`112 / 148`) üst barda; odak modunda kaydırırken 2 sn görünür, sonra kaybolur.

## 200+ vurgu

- Liste sanallaştırılır (yalnızca görünen satırlar DOM'da).
- Sayfaya göre gruplanır; grup başlıkları yapışkan, tıklayınca daralır ve daralmış halde renk şekillerini + sayıyı gösterir. "Tümünü daralt" tek tık.
- Renk çipleri sayılarla filtreler; birden fazla çip seçilebilir. Arama alanı alıntı ve notlarda anında arar.
- "Sayfayı takip et" açıkken panel, okunan sayfanın grubuna kendiliğinden kayar; kullanıcı paneli elle kaydırırsa takip duraklar, "Okuduğum sayfaya dön" bağlantısı çıkar.
- Sıralama: Sayfa (varsayılan) / Eklenme zamanı / Renk.
- Panelde `J`/`K` ile satır gezme, `Enter` atla, `E` not düzenle, `Delete` sil.

## Yaz modu

- Kalem: basınç duyarlı (stylus), çizgi 8 ms içinde ekrana düşmeli; gecikme 30 ms'yi geçerse el yazısı "yüzer" ve araç bırakılır. Çizim canvas'ta anlık, bırakınca vektöre (SVG yolu) çevrilip kaydedilir.
- Avuç reddi: stylus algılanınca parmak dokunuşu yalnızca kaydırır/zoom yapar, çizmez.
- Metin kutusu: `T` → tıkla → yaz. Kutu içeriğe göre büyür, köşe tutamaçlarıyla genişlik değişir; `Esc` bitirir, boşsa kendiliğinden silinir.
- Yapışkan not: sayfa kenarına iliştirilir; daraltıldığında 16px'lik bir köşe işaretine döner, tıklayınca açılır.
- Silgi: bütün çizgiyi siler (kısmi silme yok — tahmin edilebilir olsun). `Ctrl Z` / `Ctrl Shift Z` her işlem için.
- Seç aracı (`V`): işaretleri taşı, boyutlandır, `Del` ile sil; `Shift` ile çoklu seçim.

## Düzenle modu

- Sürükle-bırak: kart 6° eğilip `shadow-float` ile kalkar, kaynak yerinde %35 opak kalır, hedef arası 3px `accent` çizgi. Kenara yaklaşınca ızgara kendiliğinden kayar.
- Çoklu seçim: tıkla, `Shift`+tıkla aralık, `Ctrl`+tıkla tekil. Seçimle sürüklenen tüm sayfalar birlikte gider ve sayısı etikette yazar.
- Her değişiklik geri alınabilir; alt barda değişiklik sayısı ve "Kopyayı kaydet". Kaydetmeden çıkılırsa sorulur.
- Kaydetme pdf-lib ile tarayıcıda; vurgular ve çizimler yeni dosyaya taşınır, eski dosyanın vurguları ona bağlı kalır.

## AI

- Sor: seçim varken `A` → AI paneli açılır, seçim kapsam olarak girişe yerleşir, imleç girişte. 1 tuş + yazma.
- Cevap akarak gelir; durdur (`Esc`). Cihazda mod ilk cevapta model yüklenirken "Model hazırlanıyor · 12 sn" gösterir.
- Kaynak etiketine tıklamak, panelden vurguya atlamayla aynı davranır (kaydırma + parlama).
- Hata: model yüklenemedi / anahtar geçersiz / kota bitti — her biri "ne oldu + ne yapabilirsin" ve okumayı asla engellemez.

## Tekrar modu

- Giriş: üst barda Dışa aktar menüsünden "Tekrar et" ya da `Alt T`. Tam ekran, araç çubuğu tek satır.
- `Space` cevabı açar (kart 120 ms içinde aşağı uzar), `1`–`3` derecelendirir ve sıradaki karta geçer.
- Kartlar SM-2 benzeri basit aralıklarla planlanır; plan bu tarayıcıda saklanır ve yedeğe dahildir.
