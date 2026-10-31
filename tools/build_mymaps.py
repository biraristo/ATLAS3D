"""Kişisel Google My Maps haritasını (KML) tarihî eser katmanına ekler.

- tools/misir_eslesme.json'daki eşleşmeler: noktanın metinleri o Kültür Envanteri kaydının kartına "Hakkında" olarak girer
- Eşleşmeyen noktalar yeni eser olarak eklenir (tür ve aile addan çıkarılır)
Çıktı: data/heritage/hakkinda.json   (uygulama eser verisiyle birlikte yükler; ana veri dosyasına dokunmaz)

Kullanım:
  curl -sL "https://www.google.com/maps/d/kml?mid=<HARİTA_KİMLİĞİ>&forcekml=1" -o tools/.cache/misir.kml
  python3 tools/build_mymaps.py tools/.cache/misir.kml data/heritage/hakkinda.json
"""
import json, re, sys, os, xml.etree.ElementTree as ET

KML, OUT = sys.argv[1], sys.argv[2]
ESLESME = json.load(open(os.path.join(os.path.dirname(__file__), "misir_eslesme.json"), encoding="utf-8"))
NS = {"k": "http://www.opengis.net/kml/2.2"}
AILE = ["dini", "mezar", "askeri", "antik", "su", "ticari", "sivil", "ulasim", "diger"]

# Addan tür ve aile: ilk eşleşen kural geçerli
KURAL = [
    (r"\bcami|mescid|mosque", "Cami", "dini"), (r"kilise|church|katedral", "Kilise", "dini"), (r"sinagog", "Sinagog", "dini"),
    (r"manastır|deir\b", "Manastır", "dini"), (r"tekke|zaviye|makam", "Tekke", "dini"),
    (r"piramid|pyramid", "Piramit", "mezar"), (r"mastaba", "Mastaba", "mezar"), (r"mezar|türbe|kabir|tomb|\b[KTQ]V\d|\bTT\d", "Mezar", "mezar"),
    (r"nekropol|şehitlik", "Nekropol", "mezar"), (r"heykel|statue|kolos|sfenks|sphinx|dikilitaş|obelisk", "Heykel", "mezar"), (r"serapeum", "Mezar", "mezar"),
    (r"kale|sur\b|kapı|bab\b|kule|tower|fort", "Kale", "askeri"),
    (r"tapına|temple|hipostil|pylon|avlu|sütun|colonnade|şapel|ramesseum|karnak|habu", "Tapınak", "antik"),
    (r"kutsal|kobra|gisr", "Tapınak", "antik"), (r"antik|kalıntı|şehri|başkent|köy", "Antik yerleşim", "antik"),
    (r"sebil|çeşme|hamam|su kemeri|nilometre|kuyu", "Sebil", "su"),
    (r"\bhan\b|hanı|rabat|çarşı|vekale|vekil|kervansaray|souk|pazar|kafe|cafe", "Han ve çarşı", "ticari"),
    (r"köprü|bridge|fener", "Köprü ve fener", "ulasim"),
    (r"saray|palace|ev\b|evi\b|konak|müze|museum|medrese|okul|meydan|kütüphane", "Sivil yapı", "sivil"),
]


def tur_aile(ad, katman):
    if katman == "Krallar Vadisi" and not re.search(r"bilet|gişe|hazine|vadisi", ad, re.I):
        return "Kral mezarı", AILE.index("mezar")  # bu katmandaki noktalar firavun adlarıyla anılan mezarlar
    for rx, tur, aile in KURAL:
        if re.search(rx, ad, re.I):
            return tur, AILE.index(aile)
    return "Gezi noktası", AILE.index("diger")


def temiz(t):
    t = (t or "").replace("\r", "").strip()
    return re.sub(r"\n{3,}", "\n\n", t)


doc = ET.parse(KML).getroot().find("k:Document", NS)
ke, yeni = {}, []
for f in doc.findall("k:Folder", NS):
    katman = f.find("k:name", NS).text.strip()
    for p in f.findall("k:Placemark", NS):
        ad = p.find("k:name", NS).text.strip()
        lon, lat = [float(x) for x in p.find(".//k:coordinates", NS).text.strip().split(",")[:2]]
        d = {x.get("name"): temiz(x.find("k:value", NS).text) for x in p.findall(".//k:Data", NS)}
        kayit = {"ad": ad, "katman": katman}
        alan = {"donem": d.get("Dönem"), "tarih": d.get("Tarih") or d.get("Yıl"), "muellif": d.get("Müellif"),
                "unvan": d.get("Ünvan") or d.get("Unvan"), "kv": d.get("KV")}
        kayit.update({k: v for k, v in alan.items() if v})
        metin = [(b, d.get(k)) for b, k in [("Hakkında", "Hakkında"), ("Eser hakkında", "Eser Hakkında"),
                                             ("Müellif hakkında", "Müellif Hakkında"), ("Mezar hakkında", "Mezar Hakkında")] if d.get(k)]
        if metin:
            kayit["metin"] = metin
        if ad in ESLESME:
            ke.setdefault(str(ESLESME[ad]), []).append(kayit)
        else:
            tur, aile = tur_aile(ad, katman)
            yeni.append({**kayit, "lon": round(lon, 6), "lat": round(lat, 6), "tur": tur, "aile": aile})

json.dump({"v": 1, "kaynak": doc.find("k:name", NS).text, "ke": ke, "yeni": yeni},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{sum(len(v) for v in ke.values())} nokta {len(ke)} esere bağlandı, {len(yeni)} yeni eser; {os.path.getsize(OUT) / 1e3:.0f} KB")
