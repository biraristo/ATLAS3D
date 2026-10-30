# ATLAS3D Haritalar

Google Haritalar düzeninde, tamamen **3D** ve **API anahtarı gerektirmeyen** harita uygulaması. Rakım ve eğim analizi odaklıdır.

## Özellikler
- **3D harita:** arazi kabartması, 3D binalar, eğik kamera, yükseklik abartma ayarı (1×–3×)
- **Arama:** yazarken öneri (Photon), tam arama (Nominatim), koordinatla arama, son aramalar
- **Yer kartı:** adres, telefon, web sitesi, çalışma saatleri, rakım ve arazi eğimi, kaydetme, paylaşma
- **Yakındakiler:** restoran, otel, kafe, benzin, market, eczane, hastane, ATM, otopark, cami
- **Yol tarifi:** araç, yürüyüş ve bisiklet; alternatif rotalar; Türkçe adım adım tarif
- **Rakım ve eğim:**
  - rotanın haritada eğime göre renklendirilmesi (çıkış sıcak, iniş soğuk renk) ve yön okları
  - etkileşimli yükseklik profili (grafikte gezdikçe haritada nokta gösterilir)
  - toplam tırmanış/iniş, en dik çıkış/iniş, net fark, dik bölümler listesi
  - yürüyüş (Tobler) ve bisiklette eğime göre düzeltilmiş süre
- **Navigasyon:** sesli yönlendirme, rotadan çıkınca yeniden hesaplama, anlık rakım/eğim, kalan tırmanış/iniş, dik yokuş/iniş uyarısı
- **Arazi analizi:** eğim haritası, eş yükselti eğrileri, merkez/imleç rakım-eğim göstergesi, GPS'e göre "çıkıyorsunuz / iniyorsunuz"
- **Araçlar:** mesafe ölçme ve kuş uçuşu arazi kesiti, rotanın 3D kuş bakışı önizlemesi, sağ tık/uzun basma menüsü

## Kaynaklar (hepsi anahtarsız)
MapLibre GL JS · OpenFreeMap (OpenMapTiles/OSM) · Esri World Imagery · AWS Terrain Tiles · maplibre-contour · Photon · Nominatim · OSRM (routing.openstreetmap.de)

## İsteğe bağlı
Cloudflare → atlas3d → Settings → Variables and Secrets alanına `GOOGLE_MAPS_API_KEY` (Map Tiles API) eklenirse katmanlarda "Google 3D" seçeneği görünür.

## Dağıtım
Cloudflare Workers, Git bağlantısıyla çalışır: `main` dalına yapılan her push otomatik yayınlanır. `worker.js`, aramayı ve rotayı önbellekli olarak `/api/*` uçlarından sunar.

Not: Yükseklik verisi yaklaşık 30 m çözünürlüklü bir arazi modelinden gelir. Köprü ve tünellerde gerçek yol eğiminden sapabilir.
