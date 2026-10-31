"""Zaman kaydırıcısı için her esere bir yapım yılı (ya da aralığı) atar.

Kesinlik sırası:
  0  Kültür Envanteri'nin yüzyıl alanı ya da kişisel nottaki tarih
  1  Kültür Envanteri'nin dönem alanı (Neolitik, Tunç Çağı…) ya da kültürü (Osmanlı → 1299–1922)
  2  Tür + ülkeden tahmin (Avrupa'da kale → Orta Çağ, Türkiye'de cami → Türk-İslam dönemi…)
  —  tarihsiz
Aralıklı eserlerin yılı aralık içinde eser kimliğinden türetilen sabit bir noktaya yayılır: animasyonda
yüzlerce eser aynı yılda birden belirmez, genel yayılım gerçeğe yakın kalır.

Çıktı data/heritage/tarih.json:
  { "aralik": [[bas, son, "ad"], ...],
    "ke":  [[yil, kesinlik, aralik_no, (1: yıl kesin)], ... ]   # kulturenvanteri.json "eser" sırasıyla; tarihsizse null
    "m":   [[yil, kesinlik, aralik_no], ... ] } # hakkinda.json "yeni" sırasıyla
Kullanım: python3 tools/build_tarih.py
"""
import json, re, hashlib, os

D = json.load(open("data/heritage/kulturenvanteri.json", encoding="utf-8"))
H = json.load(open("data/heritage/hakkinda.json", encoding="utf-8"))
DONEM = json.load(open("tools/.cache/ke_donem.json", encoding="utf-8")) if os.path.exists("tools/.cache/ke_donem.json") else {}
S = D["sozluk"]
YER = {int(k): v for k, v in S["yer"].items()}

# Kültür → yaklaşık yapım aralığı (yıl; MÖ eksi)
KULTUR = {
    "Osmanlı": (1299, 1922), "Cumhuriyet": (1923, 2000), "Roma": (-27, 476), "Bizans": (330, 1453), "Rum": (1453, 1923),
    "Anadolu Selçuklu": (1077, 1308), "Antik Yunan": (-800, -146), "Ermeni": (300, 1915), "Helenistik": (-323, -31),
    "Levanten": (1700, 1923), "Büyük Selçuklu": (1037, 1194), "Memlük": (1250, 1517), "Hitit": (-1650, -1180), "Frig": (-1200, -650),
    "Karya": (-1000, -300), "Karamanoğlu": (1250, 1487), "Venedik": (1100, 1797), "Safevi": (1501, 1736), "Eyyubi": (1171, 1260),
    "Likya": (-1000, -200), "Antik Mısır": (-3100, -30), "Lidya": (-1200, -546), "Aydınoğlu": (1308, 1426), "Kırım": (1441, 1783),
    "Rus İmparatorluğu": (1721, 1917), "Tokugawa": (1603, 1868), "Süryani": (100, 1915), "Abbasi": (750, 1258), "Babür": (1526, 1857),
    "Kofun": (250, 538), "Urartu": (-860, -590), "Emevi": (661, 750), "Dört Halife": (632, 661), "Geç Hitit": (-1180, -700),
    "Asuka": (538, 710), "Habsburg": (1282, 1918), "Menteşeoğlu": (1280, 1424), "Timurlu": (1370, 1507), "Artuklu": (1102, 1409),
    "Pisidya": (-800, 300), "Avusturya-Macaristan İmparatorluğu": (1867, 1918), "İlhanlı": (1256, 1335), "Jōmon": (-14000, -300),
    "Asur": (-2000, -609), "Germiyanoğlu": (1300, 1429), "Akkoyunlu": (1378, 1503), "Trak": (-1000, 46), "Candaroğlu": (1291, 1461),
    "Dulkadiroğlu": (1337, 1522), "Pers": (-550, -330), "Luvi": (-2000, -700), "İyon": (-1000, -546), "Kilikya": (-800, 300),
    "Haçlı": (1096, 1291), "Kaçar": (1789, 1925), "Kutsal Roma-Germen": (962, 1806), "Ashikaga": (1336, 1573), "Sasani": (224, 651),
    "Erken Hristiyan": (30, 500), "Hospitalier Şövalyeleri": (1310, 1522), "Leleg": (-1500, -700), "Trabzon İmparatorluğu": (1204, 1461),
    "Karahanlı": (840, 1212), "Saruhanoğlu": (1302, 1410), "Danişmendliler Beyliği": (1071, 1178), "Pontus": (-281, 62),
    "Ahameniş": (-550, -330), "Kilikya Ermeni": (1080, 1375), "Ramazanoğlu": (1352, 1608), "Ubeyd": (-6500, -3800), "Kura-Aras": (-3400, -2000),
    "Galatya": (-278, 25), "Eretna": (1335, 1381), "Misya": (-1000, -133), "Şirvanşahlar": (861, 1538), "Heian": (794, 1185),
    "Alman İmparatorluğu": (1871, 1918), "Pamfilya": (-800, 300), "Bitinya": (-297, -74), "Mengücek": (1071, 1277), "Eflak": (1310, 1859),
    "Seleukos": (-312, -63), "Truva": (-3000, -85), "Prusya": (1701, 1918), "Makedon": (-808, -168), "Zengî": (1127, 1250),
    "Delhi Sultanlığı": (1206, 1526), "Ceneviz": (1100, 1797), "Tolunoğulları": (868, 905), "Fatımi": (909, 1171), "Fatimi": (909, 1171),
    "Saltuklu": (1072, 1202), "İnaloğulları": (1095, 1183), "Ptolemaios": (-305, -30), "Kommagene": (-163, 72), "Hurri": (-2500, -1300),
    "Sovyet": (1922, 1991), "Sovyetler Birliği": (1922, 1991), "Avusturya": (1500, 1918), "Macar Krallığı": (1000, 1918), "Orta Macar": (1000, 1526),
    "Kalkolitik": (-5500, -3000), "Neolitik": (-10000, -5500),
}
# Kültür Envanteri dönem etiketleri
DONEM_ARALIK = {
    "Paleolitik": (-300000, -10000), "Alt Paleolitik": (-300000, -100000), "Mezolitik": (-10000, -8000), "Neolitik": (-10000, -5500),
    "Çanak Çömleksiz Neolitik Çağ": (-10000, -6500), "Kalkolitik": (-5500, -3000), "Geç Kalkolitik": (-4000, -3000), "Prehistorik": (-10000, -3000),
    "Tunç Çağı": (-3000, -1200), "Bronz Çağı": (-3000, -1200), "Erken Tunç Çağı": (-3000, -2000), "Eski Tunç Çağı": (-3000, -2000),
    "Orta Tunç Çağı": (-2000, -1650), "Geç Tunç Çağı": (-1650, -1200), "Demir Çağı": (-1200, -550), "Demir Devri": (-1200, -550),
    "Erken Demir Çağı": (-1200, -900), "Orta Demir Çağı": (-900, -700), "Geç Demir Çağı": (-700, -550), "Arkaik Dönem": (-750, -480),
    "Antik Dönem": (-800, 476), "Geç Helenistik": (-150, -31), "Ortaçağ": (500, 1500), "Bizans": (330, 1453), "osmanlı": (1299, 1922),
    "roma": (-27, 476), "Cumhuriyet": (1923, 2000), "osmanlı cumhuriyet": (1850, 1950), "Kavalalı Mehmet Ali Paşa": (1805, 1848),
    "Nikoğos Balyan": (1840, 1858), "Sarkis Balyan": (1850, 1899), "Sovyet Sosyalist Cumhuriyetler Birliği": (1922, 1991),
    "Sovyetler Birliği": (1922, 1991), "Soğuk Savaş": (1947, 1991),
}
# Tür + ülke tahmini
TAHMIN_TARIH_ONCESI = {"Höyük", "Tümülüs", "Dolmen", "Menhir"}
TAHMIN_ANTIK = {"Antik Kent", "Antik Tiyatro", "Amfitiyatro", "Agora", "Su Kemeri", "Ören Yeri", "Nekropol"}
TAHMIN_ISLAM_TR = {"Cami", "Mescit", "Türbe", "Hazire-Mezarlık", "Kabir", "Çeşme", "Hamam", "Sebil ve Selsebil", "Medrese", "Tekke", "Zaviye",
                   "Han", "Kervansaray", "Bedesten", "Arasta", "İmaret", "Namazgâh", "Sıbyan Mektebi", "Yalı, Köşk, Konak", "Konut", "Saat Kulesi"}
TAHMIN_ORTACAG = {"Kale", "Kule", "Şato", "Gözetleme Kulesi", "Sur", "Kent Kapısı", "Manastır", "Kilise", "Katedral", "Bazilika", "Şapel", "Köprü"}
TAHMIN = {"onc": (-6000, -1200, "Tarihöncesi"), "antik": (-800, 600, "Antik dönem"), "islam": (1071, 1922, "Türk-İslam dönemi"),
          "ortacag": (1000, 1500, "Orta Çağ"), "korugan": (1900, 1950, "20. yüzyıl")}

# Mısır hanedanları (kişisel notlar)
HANEDAN = {1: (-3100, -2890), 2: (-2890, -2686), 3: (-2686, -2613), 4: (-2613, -2494), 5: (-2494, -2345), 6: (-2345, -2181),
           11: (-2134, -1991), 12: (-1991, -1802), 13: (-1803, -1649), 17: (-1580, -1550), 18: (-1550, -1292), 19: (-1292, -1189),
           20: (-1189, -1077), 22: (-943, -720), 25: (-744, -656), 26: (-664, -525), 30: (-380, -343)}
MISIR_DONEM = {"memlük": (1250, 1517), "osmanlı": (1517, 1867), "fatimi": (969, 1171), "kıpti": (300, 640), "roma": (-30, 395),
               "ptolemaios": (-305, -30), "helenistik": (-332, -30), "krallık öncesi": (-3300, -3100), "tolunoğulları": (868, 905),
               "eyyyübi": (1171, 1250), "eyyubi": (1171, 1250), "medine": (641, 661), "bizans": (395, 641), "ingiliz": (1882, 1952),
               "abbasi": (750, 868), "pers": (-525, -332), "yeni krallık": (-1550, -1070), "günümüz": (1950, 2025)}
ROMA_RAKAM = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12, "XIII": 13,
              "XIV": 14, "XV": 15, "XVI": 16, "XVII": 17, "XVIII": 18, "XIX": 19, "XX": 20}

araliklar, ara_no = [], {}


def aralik(bas, son, ad):
    k = (bas, son, ad)
    if k not in ara_no:
        ara_no[k] = len(araliklar); araliklar.append([bas, son, ad])
    return ara_no[k]


def yay(anahtar, bas, son):  # aralık içinde kimlikten türetilen sabit nokta
    h = int(hashlib.md5(str(anahtar).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return round(bas + (son - bas) * h)


def yuzyil_aralik(ad):
    m = re.match(r"\s*(MÖ\s*)?(\d+)\.\s*yy", ad or "")
    if not m: return None
    n = int(m.group(2))
    return (-n * 100, -(n - 1) * 100 - 1) if m.group(1) else ((n - 1) * 100, n * 100 - 1)


def ulke(i):
    while i in YER and YER[i][1]: i = YER[i][1]
    return YER.get(i, ["?"])[0]


def ke_tarih(e):
    pid = e[0]
    yy = [yuzyil_aralik(S["yuzyil"].get(str(k))) for k in e[7]]
    yy = [x for x in yy if x]
    if yy:
        bas, son = min(yy)  # en erken yüzyıl: yapım
        return [yay(pid, bas, son), 0, aralik(bas, son, f"{S['yuzyil'][str(min(e[7], key=lambda k: (yuzyil_aralik(S['yuzyil'].get(str(k))) or (9e9,))[0]))]}")]
    for d in DONEM.get(str(pid), []):
        if d in DONEM_ARALIK:
            bas, son = DONEM_ARALIK[d]; return [yay(pid, bas, son), 1, aralik(bas, son, d)]
    for k in e[6]:
        ad = S["kultur"].get(str(k))
        if ad in KULTUR:
            bas, son = KULTUR[ad]; return [yay(pid, bas, son), 1, aralik(bas, son, f"{ad} dönemi")]
    tur = S["tur"].get(str(e[5][0]), "") if e[5] else ""
    tr = ulke(e[11]) == "Türkiye"
    t = ("onc" if tur in TAHMIN_TARIH_ONCESI else "antik" if tur in TAHMIN_ANTIK else "islam" if tr and tur in TAHMIN_ISLAM_TR
         else "ortacag" if not tr and tur in TAHMIN_ORTACAG else "korugan" if tur == "Korugan" else None)
    if t:
        bas, son, ad = TAHMIN[t]; return [yay(pid, bas, son), 2, aralik(bas, son, ad)]
    return None


def not_tarih(anahtar, n):
    t = (n.get("tarih") or "").replace("M.ö", "MÖ").replace("M.Ö.", "MÖ").replace("M.Ö", "MÖ")
    m = re.search(r"(MÖ\s*)?(\d{1,2})\.\s*(?:yy|yüzyı)", t)
    if m:
        bas, son = yuzyil_aralik(f"{m.group(1) or ''}{m.group(2)}. yy")
        return [yay(anahtar, bas, son), 0, aralik(bas, son, f"{'MÖ ' if m.group(1) else ''}{m.group(2)}. yy")]
    m = re.search(r"(MÖ\s*)?(\d{3,4})(?:\s*[-–]\s*(\d{3,4}))?", t)
    if m:
        s = -1 if m.group(1) else 1; a = s * int(m.group(2)); b = s * int(m.group(3)) if m.group(3) else a
        bas, son = min(a, b), max(a, b)
        return [yay(anahtar, bas, son), 0, aralik(bas, son, t.strip()[:24])]
    d = (n.get("donem") or "").lower()
    nums = [int(x) for x in re.findall(r"(\d{1,2})\s*\.?\s*(?:krallık|hanedan)", d)] + \
           [ROMA_RAKAM[x.upper()] for x in re.findall(r"\b([ivx]{1,5})\s*\.?\s*(?:krallık|hanedan)", d) if x.upper() in ROMA_RAKAM]
    nums = [x for x in nums if x in HANEDAN]
    if nums:
        bas = min(HANEDAN[x][0] for x in nums); son = max(HANEDAN[x][1] for x in nums)
        return [yay(anahtar, bas, son), 1, aralik(bas, son, n.get("donem")[:30])]
    for k, (bas, son) in MISIR_DONEM.items():
        if k in d: return [yay(anahtar, bas, son), 1, aralik(bas, son, n.get("donem")[:30])]
    return None


KESIN = json.load(open("data/heritage/kesin_yil.json", encoding="utf-8")) if os.path.exists("data/heritage/kesin_yil.json") else {}
ke = []
for e in D["eser"]:
    t = ke_tarih(e)
    if str(e[0]) in KESIN:  # tools/build_kesin_yil.py: kesin yapım yılı (4. alan 1 = yılı kesin)
        y = KESIN[str(e[0])]; ke.append([y, 0, aralik(y, y, str(y)), 1]); continue
    # kişisel not daha kesin tarih veriyorsa onu kullan
    for n in H["ke"].get(str(e[0]), []):
        nt = not_tarih(e[0], n)
        if nt and (t is None or nt[1] < t[1]): t = nt
    ke.append(t)
m = [not_tarih(f"m{i}", y) for i, y in enumerate(H["yeni"])]
json.dump({"v": 1, "aralik": araliklar, "ke": ke, "m": m}, open("data/heritage/tarih.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
say = lambda L, k: sum(1 for x in L if x and x[1] == k)
print(f"kesin {say(ke, 0)}, dönem/kültür {say(ke, 1)}, tahmin {say(ke, 2)}, tarihsiz {sum(1 for x in ke if x is None)}; "
      f"Mısır yeni {sum(1 for x in m if x)}/{len(m)}; {os.path.getsize('data/heritage/tarih.json') / 1e6:.2f} MB")
