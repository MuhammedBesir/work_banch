# Özellik haritası

Bu liste "ne yapılabilir" değil, "hangi sırayla". Her satırın yanında neden orada olduğu var.

## v1 — okuma ve vurgulama (çekirdek)

- Vurgu (4 renk + şekil), not, İşaretler paneli, panelden atlama, 1–4 kısayolları
- Odak modu, açık/koyu (yumuşat), Genişliğe/Sayfaya sığdır, sürekli ve sayfa sayfa kaydırma
- **Arama** (`Ctrl F`): sonuçlar sayfa numarasıyla listede, `Enter`/`Shift Enter` gezer
- **İçindekiler ve yer imleri**: PDF'in kendi içindekiler ağacı sol şeritte ikinci sekme; `B` ile sayfaya yer imi
- **Kaldığın yer**: dosya açılınca son okunan konuma döner
- Markdown dışa aktarma, JSON yedek / geri yükleme
- **Düzenle modunun ucuz kısmı**: sırala, döndür, sil, birleştir, böl, not sayfası ekle — pdf-lib ile birkaç günlük iş, öğrenci için değeri yüksek (slayt + çıkmış soru birleştirme)

## v1.1 — üstüne yazma

- Yaz modu: kalem, metin kutusu, yapışkan not, şekil, silgi
- Vurgulu / işaretli PDF dışa aktarma (çizimler PDF'e gömülü)
- Sayfa notu (taranmış PDF'ler için vurgusuz not)
- **Tekrar modu**: Tanım vurgularından kendiliğinden kartlar, aralıklı tekrar — AI'sız da çalışır, o yüzden AI'dan önce gelir

## v2 — AI

- Önce **kendi API anahtarı** (bizde sunucu gerektirmez, en hızlı çıkar), sonra **cihazda model**
- Açıkla / basitleştir (seçim), sayfa ve bölüm özeti, "Anlamadıklarımı açıkla", sınav sorusu üret, tanımlardan kart öner
- Taranmış PDF için tarayıcıda OCR (AI ile aynı "ağır model indirme" altyapısını paylaşır)

## Bilerek yok

- PDF'in mevcut metnini düzenleme (tarayıcıda güvenilir değil)
- Hesap, senkronizasyon, paylaşım, sosyal özellikler (gizlilik vaadiyle çelişir)
- Pomodoro, rozet, seri sayacı, oyunlaştırma (dikkat dağıtır; bu bir okuma aracı)
- Serbest renk seçimi, 4'ten fazla vurgu rengi
- Aynı anda birden fazla dosya / sekme
