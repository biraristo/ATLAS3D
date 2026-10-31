"""Kültür Envanteri yer kayıtlarını ve sözlüklerini nazikçe çeker.

- Sayfa başına 100 kayıt, istekler arasında 1,5 sn bekleme, tek bağlantı
- 429 / 5xx yanıtlarında artan bekleme ile yeniden dener
- Kaldığı yerden devam eder (her sayfa ayrı dosyaya yazılır)
Kullanım: python3 tools/fetch_ke.py tools/.cache/ke   (tools/.cache depoya girmez)
"""
import json, os, sys, time, urllib.request, urllib.error

OUT = sys.argv[1]
BASE = "https://kulturenvanteri.com/wp-json/wp/v2/"
UA = "ATLAS3D-kisisel-harita/1.0 (bunyaminatalay07@gmail.com)"
DELAY = 1.5
PLACE_FIELDS = ("id,title.rendered,link,meta.geo_latitude,meta.geo_longitude,meta.place_also_known_as,"
                "place_type,place_culture,place_century,place_status,place_group,place_theme,place_administrative")
TAXES = ["place_type", "place_culture", "place_century", "place_status", "place_group", "place_theme", "place_administrative"]


def get(url):
    wait = 10
    for attempt in range(8):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r), r.headers
        except urllib.error.HTTPError as e:
            if e.code == 400:  # sayfa sınırının ötesi
                return [], {}
            if e.code in (429, 500, 502, 503, 504):
                ra = e.headers.get("Retry-After")
                w = int(ra) if ra and ra.isdigit() else wait
                print(f"  {e.code}, {w} sn bekleniyor", flush=True)
                time.sleep(w); wait = min(wait * 2, 300); continue
            raise
        except Exception as e:
            print(f"  hata: {e}, {wait} sn bekleniyor", flush=True)
            time.sleep(wait); wait = min(wait * 2, 300)
    raise RuntimeError("çok fazla hata: " + url)


def crawl(name, url_tmpl):
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    first, h = get(url_tmpl.format(page=1))
    pages = int(h.get("X-WP-TotalPages") or h.get("x-wp-totalpages") or 1)
    total = h.get("X-WP-Total") or h.get("x-wp-total")
    json.dump(first, open(os.path.join(d, "1.json"), "w"), ensure_ascii=False)
    print(f"{name}: {total} kayıt, {pages} sayfa", flush=True)
    for p in range(2, pages + 1):
        f = os.path.join(d, f"{p}.json")
        if os.path.exists(f):
            continue
        time.sleep(DELAY)
        data, _ = get(url_tmpl.format(page=p))
        json.dump(data, open(f, "w"), ensure_ascii=False)
        if p % 25 == 0:
            print(f"{name}: {p}/{pages}", flush=True)
    print(f"{name}: bitti", flush=True)


for t in TAXES:
    crawl(t, BASE + t + "?per_page=100&page={page}&orderby=id&order=asc&_fields=id,name,slug,parent,count")
crawl("place", BASE + "place?per_page=100&page={page}&orderby=id&order=asc&_fields=" + PLACE_FIELDS)
print("TAMAM", flush=True)
