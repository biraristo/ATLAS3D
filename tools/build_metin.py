"""Kültür Envanteri açıklama metinlerini temizleyip parçalara böler (kart "Hakkında" bölümü için).

- Dipnot numaraları, [1] gibi atıflar, adresler ve sondaki Kaynak/Kaynakça/Notlar bölümü çıkarılır
- Eserler kimliğe göre 256 parçaya dağıtılır: data/heritage/metin/<kimlik % 256>.json  { "kimlik": ["paragraf", ...] }
- Wikidata kimlikleri ayrı dosyada: data/heritage/wikidata.json  { "kimlik": "Q…" }
Kullanım: python3 tools/build_metin.py tools/.cache/ke_metin
"""
import glob, html, json, os, re, sys, shutil

SRC = sys.argv[1]
OUT = "data/heritage/metin"
PARCA = 256
KESIM = re.compile(r"^\s*(Kaynak(ça|lar)?|Notlar|Dipnotlar|Referanslar|Bibliyografya|Kaynaklar ve Notlar)\s*:?\s*$", re.I | re.M)


def temizle(h):
    h = re.sub(r"<(sup|figure|script|style|table)[^>]*>.*?</\1>", "", h, flags=re.S | re.I)
    h = re.sub(r"</(p|h\d|li|div)>|<br\s*/?>", "\n", h, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", h)).replace("\xa0", " ")
    m = KESIM.search(t)
    if m: t = t[:m.start()]
    t = re.split(r"\n\s*\[1\]|\n\s*1\s+[A-ZÇĞİÖŞÜ][^\n]{0,80}(erişim|Erişim|s\.\s*\d|ss\.\s*\d)", t)[0]
    t = re.sub(r"\[\d+(?:[-–,]\s*\d+)*\]", "", t)                   # [1], [2-3]
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"\s*Kaynak\s*:.*$", "", t, flags=re.S)
    paragraflar = []
    for p in t.split("\n"):
        p = re.sub(r"\s+", " ", p).strip()
        if len(p) < 25 and not paragraflar: continue                 # baştaki kısa artıklar
        if not p: continue
        if re.match(r"^\d+\s", p) and re.search(r"(erişim|s\.\s*\d|Yayın|Yay\.|Press|Verlag)", p): continue  # tek tek dipnot satırları
        paragraflar.append(p)
    return paragraflar if sum(map(len, paragraflar)) >= 60 else []


rows = [r for f in glob.glob(os.path.join(SRC, "*.json")) for r in json.load(open(f, encoding="utf-8"))]
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
parca = [dict() for _ in range(PARCA)]
wd, n, kar = {}, 0, 0
for r in rows:
    q = (r.get("meta") or {}).get("place_identifier_wikidata") or ""
    if re.fullmatch(r"Q\d+", q): wd[str(r["id"])] = q
    ps = temizle(r["content"]["rendered"])
    if ps:
        parca[r["id"] % PARCA][str(r["id"])] = ps; n += 1; kar += sum(map(len, ps))
for k, d in enumerate(parca):
    json.dump(d, open(os.path.join(OUT, f"{k}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(wd, open("data/heritage/wikidata.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
boyut = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print(f"{n} eserin metni, {kar / 1e6:.1f} M karakter, {PARCA} parça, {boyut / 1e6:.1f} MB; wikidata {len(wd)} ({os.path.getsize('data/heritage/wikidata.json') / 1e6:.1f} MB)")
