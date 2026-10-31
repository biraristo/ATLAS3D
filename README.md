# ATLAS3D Haritalar

Telefonda uygulama gibi kurulabilen (PWA) **3D** harita. Rakım ve eğim analizi odaklıdır; yol tarifi, canlı trafik ve köprü/otoyol ücretleri içerir.

## Özellikler
- **3D harita:** arazi kabartması, 3D binalar, 2D / 3D / Ufuk kamera modları (ufuk çizgisine kadar eğik görünüm, navigasyonda da), yükseklik abartma (varsayılan 3×), harita ve uydu görünümü; eğim haritası ve eş yükselti eğrileri varsayılan açık (tik ile kapatılabilir); rota ve navigasyon ekranında sağdaki katman tuşuyla harita türü ve katmanlar değiştirilebilir
- **Arama:** yazarken öneri (Photon, isteğe bağlı Mapbox adresleri), tam arama (Nominatim), koordinatla arama, son aramalar
- **Yer kartı:** adres, telefon, web sitesi, çalışma saatleri (OSM), rakım ve arazi eğimi, kaydetme, paylaşma
- **Yakındakiler:** restoran, otel, kafe, benzin, market, eczane, hastane, ATM, otopark, cami
- **Yol tarifi:** araç, yürüyüş ve bisiklet; alternatif rotalar; Türkçe adım adım tarif; köprü, otoyol ve feribot ücretleri
- **Yolculuk maliyeti:** aracını marka, model, yıl ve motoruyla seç (53 marka, 2010–2025, ~31 bin motor seçeneği); tüketim o araca özel fizik modeliyle hesaplanır: aracın resmî test döngüsü (WLTC 3b ya da NEDC) saniye saniye simüle edilip motor modeli resmî tüketime kalibre edilir, sonra rotada eğim, yol tipine göre gerçekçi seyir hızı ve sürüş tarzı, dur-kalk, rakım ve sıcaklığa göre hava yoğunluğu, rüzgârın rota yönündeki bileşeni, klima/ısıtma, soğuk çalıştırma, trafik gecikmesi ve yolcu yükü hesaba katılır; hafif hibrit, tam hibrit, şarj edilebilir hibrit (başlangıç şarjına göre önce batarya) ve elektrikli araçlar ayrı modellenir; sonradan LPG dönüşümü seçilebilir; sonuç belirsizlik aralığıyla (±%) gösterilir. Katalogda olmayan araç için gövde tipi ve ortalama tüketimle elle giriş sürer
- **Canlı trafik (TomTom anahtarı varsa):** trafik katmanı, trafiğe göre süre ve rota, ücretli yol içermeyen seçenek, ulaşılabilir alan
- **Rakım ve eğim:** eğime göre renklendirilmiş rota, etkileşimli yükseklik profili, toplam tırmanış/iniş, dik bölümler, eğime göre düzeltilmiş yürüyüş/bisiklet süresi, ayrıntılı rota analizi ve GPX
- **Navigasyon:** sesli yönlendirme, rotadan çıkınca yeniden hesaplama, anlık rakım/eğim, dik yokuş uyarısı, anlık yakıt tüketimi (GPS hızı, hızlanma ve eğimden), harcanan yakıt, yakıt ücreti ve geçilen gişelerle birlikte toplam maliyet, hız önerisi ve yolculuk sonu özeti
- **Arazi analizi:** eğim haritası, eş yükselti eğrileri, merkez/imleç rakım-eğim göstergesi
- **Menü:** Araçlarım (birden fazla araç; katalogdan seçim ya da elle giriş, depo hacmi, isteğe bağlı fiyat; 100 km maliyeti ve depo menzili; **yakıt alımları**: depo dolu → depo dolu kayıtlarından gerçek ortalama hesaplanır, hesaplar araca ve sürücüye göre düzeltilir, belirsizlik aralığı daralır), yolculuk geçmişi (aylık km, yakıt ve maliyet toplamı), akaryakıt fiyatları (EPDK), ev ve iş (tek dokunuşla yol tarifi, aramada öneri), aracın yakıtına göre yakındaki benzinlik/şarj istasyonları, ulaşılabilir alan
- **Tarihî eser:** üst çubuktaki düğmeyle ~84 bin eser 2D haritada; aileye göre renkli sekizgen mühürler (dinî, türbe/anıt, kale, antik, çeşme/hamam, han/çarşı, sivil, köprü), sekiz köşeli yıldız kümeleri, aile filtresi; kayıp / toprak altı / su altı eserler içi boş mühür. Kartta tür, kültür, dönem, konum, yol tarifi ve Kültür Envanteri bağlantısı
- **Görünüm:** varsayılan aydınlık; menüden Aydınlık / Koyu / Sistem seçilebilir; koyu temada arayüz ve harita renkleri birlikte koyulaşır
- **Araçlar:** mesafe ölçme ve arazi kesiti, rotanın 3D kuş bakışı önizlemesi, sağ tık/uzun basma menüsü

## Kaynaklar
Anahtarsız: EPDK günlük akaryakıt ve LPG bayi satış fiyatı bülteni (açık REST servisi) · Open-Meteo (rota boyunca sıcaklık ve rüzgâr) · AB Çevre Ajansı (EEA) yeni binek araç CO₂ izleme verisi (araç kataloğu, derleme sırasında) · JRC `wltp` paketi (WLTC/NEDC hız izleri) · MapLibre GL JS · OpenFreeMap (OpenMapTiles/OSM) · Esri World Imagery · AWS Terrain Tiles · maplibre-contour · Photon · Nominatim · OSRM (routing.openstreetmap.de)

İsteğe bağlı (Cloudflare → atlas3d → Settings → Variables and Secrets, gizli değişken olarak):
- `TOMTOM_API_KEY` — canlı trafik, trafiğe göre rotalar, ulaşılabilir alan
- `MAPBOX_TOKEN` — yazarken adres/kapı numarası önerileri

Anahtarlar yalnızca sunucuda (Worker) kalır, tarayıcıya gönderilmez.

## Dağıtım
Cloudflare Workers, Git bağlantısıyla çalışır: `main` dalına yapılan her push otomatik yayınlanır. `worker.js` tüm dış servisleri önbellekli olarak `/api/*` uçlarından sunar.

Koruma: başka sitelerden tarayıcı ile yapılan API çağrıları reddedilir; `wrangler.toml` içindeki `[[ratelimits]]` bağları IP başına dakikalık sınır uygular (API 300, trafik karoları 1500).

Kontrol: `/api/health` · GitHub Actions her push sonrası canlı siteyi test eder.

## Araç kataloğu
`data/vehicles/` dosyaları depoda hazır gelir; yeniden üretmek için:

```
python3 tools/fetch_eea.py      # EEA'nın açık SQL servisinden yıllık özetleri indirir (tools/.cache/, depoya girmez)
python3 tools/build_vehicles.py # model adlarını temizler, birleştirir ve marka başına JSON yazar
```

Her motor seçeneğinde boş ağırlık, motor hacmi, güç, güç aktarımı ve resmî tüketim (2021+ WLTP, öncesi NEDC CO₂'den karbon dengesiyle) vardır. Değerler EEA kaydından gelir; yalnızca model adları birleştirilir. Türkiye'ye özgü adlar açıkça eşleştirilir (Egea = Tipo; Taliant = Logan III ile aynı taban ve motorlar).

Tüketim modeli ve sınırları: test döngüsü ile yol arasındaki ölçülemeyen fark için WLTP'de %8–12, NEDC'de %12–20 sabit pay eklenir (ICCT "From laboratory to road" bulgularına göre; hız, klima ve soğuk çalıştırma payı ayrıca modellendiği için toplam farkın tamamı değildir). Vites, şanzıman türü ve lastik ebadı veride olmadığı için modellenmez; bu fark yakıt alımlarından öğrenilen kişisel katsayıyla kapanır. Şarj edilebilir hibritte batarya boşken tüketim için resmî veri yoktur, hibrit fiziğinden tahmin edilir (aralık daha geniştir).

## Tarihî eser verisi

`data/heritage/kulturenvanteri.json` Kültür Envanteri'nin (kulturenvanteri.com) yer kayıtlarından derlenir: ad, koordinat, tür, kültür, yüzyıl, durum ve konum. Açıklama metinleri ve fotoğraflar alınmaz; kart eserin Kültür Envanteri sayfasına bağlantı verir. Yeniden üretmek için:

```
python3 tools/fetch_ke.py tools/.cache/ke   # istekler arasında 1,5 sn bekler, kaldığı yerden devam eder (~45 dk)
python3 tools/build_ke.py tools/.cache/ke data/heritage/kulturenvanteri.json
```

## Notlar
- Yükseklik verisi yaklaşık 30 m çözünürlüklü bir arazi modelinden gelir. Köprü ve tünellerde gerçek yol eğiminden sapabilir (araç rotalarında otomatik düzeltilir).
- Retina ekranlarda uydu karoları bir üst ayrıntı düzeyinden istenir; görüntü keskin ama veri kullanımı daha yüksektir.
