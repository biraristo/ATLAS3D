"""İndirilen Kültür Envanteri sayfalarını ATLAS3D için tek, sıkı bir JSON'a çevirir.

Çıktı biçimi (uygulama yüklerken GeoJSON'a çevirir):
{
  "v": 1, "aile": AILE, "kaynak": "...", "tarih": "YYYY-MM-DD",
  "sozluk": { "tur": {id: ad}, "kultur": {...}, "yuzyil": {...}, "durum": {...}, "grup": {...}, "tema": {...}, "yer": {id: [ad, ust_id]} },
  "eser": [[id, ad, lon, lat, slug, [tur], [kultur], [yuzyil], durum, grup, [tema], yer_id, diger_ad, aile], ...]
}
yer_id: kaydın en ayrıntılı idari birimi (mahalle/ilçe); üst zincir sözlükten çözülür.
Kullanım: python3 tools/build_ke.py <indirme_klasörü> <çıktı.json>
"""
import glob, json, os, sys, datetime, html

SRC, OUT = sys.argv[1], sys.argv[2]


def pages(name):
    rows = []
    for f in sorted(glob.glob(os.path.join(SRC, name, "*.json")), key=lambda p: int(os.path.basename(p)[:-5])):
        rows += json.load(open(f))
    return rows


def names(name):
    return {x["id"]: html.unescape(x["name"]) for x in pages(name)}


admin = {x["id"]: (html.unescape(x["name"]), x["parent"]) for x in pages("place_administrative")}


def depth(i):
    d = 0
    while i in admin and admin[i][1]:
        i = admin[i][1]; d += 1
    return d


# İşaret aileleri (uygulamadaki renk ve simge sırası ile aynı): önce türe, sonra yapı grubuna bakılır
AILE = ["dini", "mezar", "askeri", "antik", "su", "ticari", "sivil", "ulasim", "diger"]
TUR_AILE = {
    "Cami": "dini", "Mescit": "dini", "Kilise": "dini", "Katedral": "dini", "Bazilika": "dini", "Manastır": "dini", "Şapel": "dini", "Sinagog": "dini", "Cemevi": "dini", "Tekke": "dini", "Zaviye": "dini",
    "Türbe": "mezar", "Hazire-Mezarlık": "mezar", "Kabir": "mezar", "Tümülüs": "mezar", "Anıt Mezar": "mezar", "Şehitlik": "mezar", "Dolmen": "mezar", "Nekropol": "mezar", "Anıt": "mezar", "Heykel": "mezar",
    "Çeşme": "su", "Sebil ve Selsebil": "su", "Hamam": "su", "Sarnıç": "su", "Su Kemeri": "su", "Kuyu": "su", "Su Terazisi": "su",
    "Kervansaray": "ticari", "Han": "ticari", "Bedesten": "ticari", "Arasta": "ticari", "Dükkân": "ticari", "Pasaj-İşhanı": "ticari",
    "Köprü": "ulasim", "Deniz Feneri": "ulasim", "Tren İstasyonu": "ulasim", "İskele-Liman": "ulasim",
    "Höyük": "antik", "Antik Kent": "antik", "Ören Yeri": "antik", "Antik Tiyatro": "antik", "Amfitiyatro": "antik", "Agora": "antik",
}
GRUP_AILE = {
    "Dini Yapı": "dini", "Askeri Yapı": "askeri", "Antik Yapı": "antik", "Yerleşim": "antik", "Su Yapısı": "su", "Ulaşım Yapısı": "ulasim",
    "Ticari Yapı": "ticari", "Sosyal Yapı": "sivil", "Sivil Yapı": "sivil", "İdari Yapı": "sivil", "Eğitim Yapısı": "sivil", "Endüstri Yapısı": "sivil",
    "Anıt Yapı": "mezar",
}
TUR_AD, GRUP_AD = names("place_type"), names("place_group")


def aile(turler, grup):
    for t in turler:
        a = TUR_AILE.get(TUR_AD.get(t, ""))
        if a: return AILE.index(a)
    return AILE.index(GRUP_AILE.get(GRUP_AD.get(grup, ""), "diger"))


places = pages("place")
seen, eser, skipped = set(), [], {"koordinatsız": 0, "yinelenen": 0}
used_admin = set()
for p in places:
    if p["id"] in seen:
        skipped["yinelenen"] += 1; continue
    seen.add(p["id"])
    m = p.get("meta") or {}
    try:
        lat, lon = float(m.get("geo_latitude") or "x"), float(m.get("geo_longitude") or "x")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0): raise ValueError
    except ValueError:
        skipped["koordinatsız"] += 1; continue
    adm = [a for a in p.get("place_administrative") or [] if a in admin]
    leaf = max(adm, key=depth) if adm else 0
    i = leaf
    while i in admin:
        used_admin.add(i); i = admin[i][1]
    slug = p["link"].rstrip("/").rsplit("/", 1)[-1]
    eser.append([p["id"], html.unescape(p["title"]["rendered"]), round(lon, 5), round(lat, 5), slug,
                 p.get("place_type") or [], p.get("place_culture") or [], p.get("place_century") or [],
                 (p.get("place_status") or [0])[0], (p.get("place_group") or [0])[0], p.get("place_theme") or [],
                 leaf, html.unescape(m.get("place_also_known_as") or ""),
                 aile(p.get("place_type") or [], (p.get("place_group") or [0])[0])])

out = {
    "v": 1, "aile": AILE,
    "kaynak": "Kültür Envanteri (kulturenvanteri.com)",
    "tarih": datetime.date.today().isoformat(),
    "sozluk": {
        "tur": TUR_AD, "kultur": names("place_culture"), "yuzyil": names("place_century"),
        "durum": names("place_status"), "grup": GRUP_AD, "tema": names("place_theme"),
        "yer": {i: [admin[i][0], admin[i][1]] for i in sorted(used_admin)},
    },
    "eser": eser,
}
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(places)} kayıt okundu, {len(eser)} eser yazıldı; atlanan: {skipped}; {os.path.getsize(OUT)/1e6:.1f} MB")
