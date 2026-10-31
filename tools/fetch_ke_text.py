"""Kültür Envanteri açıklama metinlerini ve Wikidata kimliklerini nazikçe çeker (fetch_ke.py ile aynı kurallar).

Kullanım: python3 tools/fetch_ke_text.py tools/.cache/ke_metin
"""
import json, os, sys, time, urllib.request, urllib.error

OUT = sys.argv[1]
URL = ("https://kulturenvanteri.com/wp-json/wp/v2/place?per_page=100&page={page}&orderby=id&order=asc"
       "&_fields=id,content.rendered,meta.place_identifier_wikidata,meta.place_wikipedia")
UA = "ATLAS3D-kisisel-harita/1.0 (bunyaminatalay07@gmail.com)"
os.makedirs(OUT, exist_ok=True)


def get(url):
    wait = 10
    for _ in range(8):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r), r.headers
        except urllib.error.HTTPError as e:
            if e.code == 400:
                return [], {}
            if e.code in (429, 500, 502, 503, 504):
                ra = e.headers.get("Retry-After")
                w = int(ra) if ra and ra.isdigit() else wait
                print(f"  {e.code}, {w} sn bekleniyor", flush=True); time.sleep(w); wait = min(wait * 2, 300); continue
            raise
        except Exception as e:
            print(f"  hata: {e}, {wait} sn bekleniyor", flush=True); time.sleep(wait); wait = min(wait * 2, 300)
    raise RuntimeError(url)


first, h = get(URL.format(page=1))
pages = int(h.get("X-WP-TotalPages") or h.get("x-wp-totalpages") or 1)
json.dump(first, open(os.path.join(OUT, "1.json"), "w"), ensure_ascii=False)
print(f"{pages} sayfa", flush=True)
for p in range(2, pages + 1):
    f = os.path.join(OUT, f"{p}.json")
    if os.path.exists(f):
        continue
    time.sleep(1.5)
    data, _ = get(URL.format(page=p))
    json.dump(data, open(f, "w"), ensure_ascii=False)
    if p % 50 == 0:
        print(f"{p}/{pages}", flush=True)
print("TAMAM", flush=True)
