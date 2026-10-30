# Riskler ve ilk sürümden çıkarılacaklar

## Önce en büyüğü: kapsam

Yaz modu, Düzenle modu ve AI eklenince bu artık bir PDF okuyucu değil, üç ürün: okuyucu, not alma tableti ve AI çalışma asistanı. Üçünü birden ilk sürüme koyarsan hiçbiri iyi olmaz ve en kritik olanı — vurgulamanın sorunsuz çalışması — test edilmeden çıkar. Sıra `Özellik haritası` bölümünde: önce oku+vurgula+sayfa düzenleme, sonra yazma, en son AI.

## Ürün riskleri (sert ve açık)

- **Veri kaybı, hâlâ en büyük risk — ve artık daha pahalı.** Vurgulara ek olarak el yazısı çizimler, metin kutuları ve tekrar kartı geçmişi de yalnızca tarayıcıda (IndexedDB) yaşıyor. Safari 7 gün kullanılmayan sitenin verisini silebilir; kullanıcı tarayıcı verisini temizler; bilgisayar değiştirir. `navigator.storage.persist()` iste, düzenli yedek hatırlat, JSON yedeği ilk günden yap. Güven mesajı bu yüzden saklama yerini de söylüyor.
- **AI, gizlilik vaadiyle doğrudan çelişiyor.** "Dosyan bilgisayarından çıkmaz" cümlesi bulut AI açıkken yalan olur. Çözüm tasarımda var (varsayılan kapalı, cihazda öncelikli, her istekte gönderilecek metin görünür, arada sunucu yok) ama tek bir gizli istek — örneğin arka planda "akıllı özet" — ürünün güvenini bitirir. Kural: AI hiçbir şeyi kendiliğinden göndermez.
- **Cihazda model gerçekçi beklentiyle sunulmalı.** ~1,5 GB indirme, WebGPU şartı (Safari ve eski cihazlarda yok ya da kısıtlı), Türkçe akademik metinde küçük modellerin kalitesi orta. Cihazda modu "her şeyi yapar" gibi pazarlama; kısa açıklama ve basitleştirmede iyi, bölüm özetinde zayıf.
- **AI yanlış bilgisi sınavda can yakar.** Bu yüzden her cevap sayfa kaynağına bağlı, AI kartları onaysız desteye girmiyor, AI notları etiketli. Kaynak gösteremeyen cevabı soluk göstermek yeterli değilse göstermemek daha iyi.
- **API anahtarı tarayıcıda.** XSS'e açık bir tarayıcı uygulamasında anahtar çalınabilir; CSP sıkı olmalı, üçüncü taraf script olmamalı. Kullanıcıya düşük limitli anahtar önermek de iyi bir pratik.
- **Kalem gecikmesi ürünün kaderini belirler.** 30 ms'nin üstünde gecikme el yazısını kullanılamaz kılar; tablette kâğıt hissi vermeyen bir kalem hiç olmamasından kötüdür. Canvas anlık çizim + sonradan vektör, ve gerçek iPad/Android tablette erken test şart.
- **Çizimlerin PDF'e gömülmesi.** Dışa aktarılan işaretli PDF farklı okuyucularda (Acrobat, Preview, tarayıcı) farklı görünür; annotation mı, düzleştirilmiş içerik mi kararını baştan ver. Öneri: varsayılan düzleştir (her yerde aynı görünür), "düzenlenebilir işaretler" seçenek.
- **Sayfa düzenleme sessizce bir şeyleri bozabilir.** Birleştirme ve sayfa silme; PDF içi bağlantıları, içindekiler ağacını, form alanlarını ve imzaları bozar. Bunu kaydetmeden önce tek satırla söyle ("Bu dosyadaki 12 iç bağlantı yeni kopyada çalışmayabilir").
- **"Son açılanlar" sandığın kadar kolay değil.** Tarayıcı dosyayı kullanıcı yeniden seçmeden tekrar açamaz. File System Access API yalnızca Chromium'da; diğerlerinde OPFS kopyası (kota sorunu) ya da "Dosyayı yeniden seç". Vurgular dosya adına değil içerik özetine (hash) bağlanmalı. Düzenle modunda üretilen kopya yeni bir hash demek; işaretlerin yeni dosyaya taşınması bilinçli yapılmalı.
- **Metin seçimi PDF'te kırılgandır.** PDF.js metin katmanı çok sütunlu kitaplarda, formüllerde ve bazı slaytlarda yanlış sırada seçer; μ, σ, √ kopyalanınca çöp çıkabilir. Bu aynı zamanda AI'ya giden metnin de bozuk olması demek.
- **Taranmış PDF oranı yüksek.** Türk üniversitelerinde taranmış kitap bölümü yaygın. Bu dosyalarda vurgu, arama ve AI çalışmaz; Yaz modu ise çalışır — bu, Yaz modunu öne almak için iyi bir sebep.
- **Klavye kısayolu kalabalığı.** 1–4, harfler, Alt+rakam, Shift+rakam, Ctrl kombinasyonları. Mod bazlı tutarlılık şart ve `?` listesi her zaman güncel olmalı; yoksa kimse kullanmaz.
- **Büyük dosya ve bellek.** Yaz modu katmanları ve AI modeli bellek kullanımını katlar; mobil tarayıcıda AI + büyük PDF birlikte çöker. Mobilde cihazda AI'yı hiç sunma.
- **Mobilde metin seçimi ve kalem kötü.** Mobil gözden geçirme ve tekrar modu için; yazma ve düzenleme tablet ve masaüstünde.

## İlk sürümden çıkar

- **Yaz modu** (v1.1) — kalem gecikmesi ve PDF'e gömme işi ayrı bir sprint ister.
- **AI** (v2) — gizlilik iletişimi, model indirme, hata durumları ve kalite testi ayrı bir sprint ister.
- **Vurgulu / işaretli PDF dışa aktarma** (Yaz moduyla birlikte gelir). Pencerede seçenek, gelene kadar tamamen gizli; "yakında" etiketi koyma.
- **Koyu temada invert.**
- **Serbest renk seçimi ve 4'ten fazla renk.**
- **Çoklu dosya / sekme ve dosyalar arası arama.**
- **OCR.** Sadece uyarı.
- **Senkronizasyon / hesap.**

## İlk sürümde kalmalı (kesme)

Vurgu + not + panel + atlama, 1–4 kısayolları, arama, içindekiler, odak modu, açık/koyu (yumuşat), Düzenle modunun sayfa işlemleri, Markdown dışa aktarma, JSON yedek/geri yükleme, taranmış/bozuk/büyük/parolalı dosya mesajları.
