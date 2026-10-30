# ATLAS3D Haritalar

Telefonda uygulama gibi kurulabilen (PWA) **3D** harita. Rakım ve eğim analizi odaklıdır; yol tarifi, canlı trafik ve köprü/otoyol ücretleri içerir.

## Özellikler
- **3D harita:** arazi kabartması, 3D binalar, 2D / 3D / Ufuk kamera modları (ufuk çizgisine kadar eğik görünüm, navigasyonda da), yükseklik abartma (varsayılan 3×), harita ve uydu görünümü; eğim haritası ve eş yükselti eğrileri varsayılan açık (tik ile kapatılabilir); rota ve navigasyon ekranında sağdaki katman tuşuyla harita türü ve katmanlar değiştirilebilir
- **Arama:** yazarken öneri (Photon, isteğe bağlı Mapbox adresleri), tam arama (Nominatim), koordinatla arama, son aramalar
- **Yer kartı:** adres, telefon, web sitesi, çalışma saatleri (OSM), rakım ve arazi eğimi, kaydetme, paylaşma
- **Yakındakiler:** restoran, otel, kafe, benzin, market, eczane, hastane, ATM, otopark, cami
- **Yol tarifi:** araç, yürüyüş ve bisiklet; alternatif rotalar; Türkçe adım adım tarif; köprü, otoyol ve feribot ücretleri
- **Yolculuk maliyeti:** araç tipi (hatchback, sedan, SUV, hafif ticari, motosiklet), yakıt (benzin, dizel, LPG, elektrik), ortalama tüketim ve yolcu sayısına göre yakıt + geçiş ücreti toplamı, kişi başı maliyet; tüketim eğim, hız, hızlanma ve rölantiyi hesaba katan fizik modeliyle tahmin edilir ve yakıtın nereye gittiği gösterilir
- **Canlı trafik (TomTom anahtarı varsa):** trafik katmanı, trafiğe göre süre ve rota, ücretli yol içermeyen seçenek, ulaşılabilir alan
- **Rakım ve eğim:** eğime göre renklendirilmiş rota, etkileşimli yükseklik profili, toplam tırmanış/iniş, dik bölümler, eğime göre düzeltilmiş yürüyüş/bisiklet süresi, ayrıntılı rota analizi ve GPX
- **Navigasyon:** sesli yönlendirme, rotadan çıkınca yeniden hesaplama, anlık rakım/eğim, dik yokuş uyarısı, anlık yakıt tüketimi (GPS hızı, hızlanma ve eğimden), harcanan yakıt, yakıt ücreti ve geçilen gişelerle birlikte toplam maliyet, hız önerisi ve yolculuk sonu özeti
- **Arazi analizi:** eğim haritası, eş yükselti eğrileri, merkez/imleç rakım-eğim göstergesi
- **Menü:** Araçlarım (birden fazla araç: ad, tip, yakıt, ortalama tüketim, depo hacmi, isteğe bağlı fiyat; 100 km maliyeti ve depo menzili), yolculuk geçmişi (aylık km, yakıt ve maliyet toplamı), akaryakıt fiyatları (EPDK), ev ve iş (tek dokunuşla yol tarifi, aramada öneri), aracın yakıtına göre yakındaki benzinlik/şarj istasyonları, ulaşılabilir alan
- **Görünüm:** varsayılan aydınlık; menüden Aydınlık / Koyu / Sistem seçilebilir; koyu temada arayüz ve harita renkleri birlikte koyulaşır
- **Araçlar:** mesafe ölçme ve arazi kesiti, rotanın 3D kuş bakışı önizlemesi, sağ tık/uzun basma menüsü

## Kaynaklar
Anahtarsız: EPDK günlük akaryakıt ve LPG bayi satış fiyatı bülteni (açık REST servisi) · MapLibre GL JS · OpenFreeMap (OpenMapTiles/OSM) · Esri World Imagery · AWS Terrain Tiles · maplibre-contour · Photon · Nominatim · OSRM (routing.openstreetmap.de)

İsteğe bağlı (Cloudflare → atlas3d → Settings → Variables and Secrets, gizli değişken olarak):
- `TOMTOM_API_KEY` — canlı trafik, trafiğe göre rotalar, ulaşılabilir alan
- `MAPBOX_TOKEN` — yazarken adres/kapı numarası önerileri

Anahtarlar yalnızca sunucuda (Worker) kalır, tarayıcıya gönderilmez.

## Dağıtım
Cloudflare Workers, Git bağlantısıyla çalışır: `main` dalına yapılan her push otomatik yayınlanır. `worker.js` tüm dış servisleri önbellekli olarak `/api/*` uçlarından sunar.

Koruma: başka sitelerden tarayıcı ile yapılan API çağrıları reddedilir; `wrangler.toml` içindeki `[[ratelimits]]` bağları IP başına dakikalık sınır uygular (API 300, trafik karoları 1500).

Kontrol: `/api/health` · GitHub Actions her push sonrası canlı siteyi test eder.

## Notlar
- Yükseklik verisi yaklaşık 30 m çözünürlüklü bir arazi modelinden gelir. Köprü ve tünellerde gerçek yol eğiminden sapabilir (araç rotalarında otomatik düzeltilir).
- Retina ekranlarda uydu karoları bir üst ayrıntı düzeyinden istenir; görüntü keskin ama veri kullanımı daha yüksektir.
