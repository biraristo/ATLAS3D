# ATLAS3D

3D uydu haritası ve GPS takip prototipi. **Hiçbir API anahtarı gerektirmez.**

## Kullanılan açık / anahtarsız kaynaklar
| Özellik | Kaynak |
|---|---|
| Harita motoru | MapLibre GL JS 5 |
| Uydu görüntüsü (Uydu / Hibrit) | Esri World Imagery + Esri yol/yer adı katmanları |
| Topoğrafik harita | OpenTopoMap (eş yükselti eğrileri) |
| Sokak haritası | Esri World Street Map |
| 3D arazi ve rakım | AWS Terrain Tiles (Terrarium, açık veri) |
| Yer arama | OpenStreetMap Nominatim — Worker üzerinden `/api/search` (önbellekli) |

## İsteğe bağlı ek katmanlar
Cloudflare → atlas3d → **Settings → Variables and Secrets** (Build değil) alanına eklenirse menüde otomatik görünür:
- `MAPTILER_API_KEY` → "MapTiler Uydu"
- `GOOGLE_MAPS_API_KEY` (Map Tiles API etkin) → "Google 3D" (fotogerçekçi 3D şehirler)

## Dağıtım
Cloudflare Workers (Git bağlantısı) — `main` dalına her push otomatik yayınlanır. `wrangler.toml` ayarları yeterlidir.

## Notlar
GPS için HTTPS ve konum izni gerekir. Rakım, ekran merkezindeki (veya takipteyken konumunuzdaki) arazi yüksekliğidir; GPS rakımı değildir.
