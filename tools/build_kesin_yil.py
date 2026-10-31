"""Koleksiyonların "yolculuğu oynat" özelliği için eserlere kesin yapım yılı atar.

Kaynaklar:
  1. tools/sinan_camileri.txt  — Mimar Sinan cuma camileri (Vikipedi); elle doğrulanmış eşleşme tablosu aşağıda
  2. Wikidata yapım tarihi (P571, yıl ya da daha kesin) — tools/.cache/wd_p571_mimar.json
  3. Külliye yayılımı: kesin yıllı bir caminin 400 m içindeki, aynı baniye ait yapıları (medrese, imaret, hamam…) aynı yılı alır
Çıktı: data/heritage/kesin_yil.json  { "kimlik": yıl }
Kullanım: python3 tools/build_kesin_yil.py
"""
import json, math, os, re, unicodedata

D = json.load(open("data/heritage/kulturenvanteri.json", encoding="utf-8"))
W = json.load(open("data/heritage/wikidata.json", encoding="utf-8"))
E = D["eser"]
AD = {}
for e in E: AD.setdefault(e[1].replace("\xa0", " ").strip(), []).append(e)

# Vikipedi listesindeki ad | yer → Kültür Envanteri'ndeki ad (elle doğrulandı; emin olunamayanlar yok)
ESLESME = {
    ("Haseki Sultan Mosque", "Haseki"): "Haseki Sultan Camii", ("Çukurcuma Mosque", "Tophane"): "Çukurcuma Camii",
    ("Nişancı Mustafa Çelebi Mosque", "Eyüp"): "Nişancı Mustafa Paşa Camii", ("Mihrimah Sultan Mosque", "Üsküdar"): "Mihrimah Sultan Camii",
    ("Şehzade Mosque", "Şehzadebası"): "Şehzade Mehmet Camii", ("Khusrawiyya Mosque", "Aleppo"): "Hüsreviye Camii",
    ("Süleymaniye Mosque", "Süleymaniye"): "Süleymaniye Camii", ("Rüstem Pasha Mosque", "Tekirdağ"): "Rüstem Paşa Camii, Tekirdağ",
    ("Hadim Ibrahim Pasha Mosque", "Silivrikapı"): "Hadım İbrahim Paşa Camii", ("Çerkes İskender Pasha Mosque", "Diyarbakır"): "İskender Paşa Camii, Diyarbakır",
    ("Tatar Khan or Juma-Jami Mosque", "Yevpatoria"): "Tatar Han Camii, Gözleve", ("Kapıağası Mahmud Agha Mosque", "Ahırkapı"): "Kapı Ağası Mahmut Ağa Camii",
    ("Sulaymaniyya Takiyya Mosque", "Damascus"): "Süleymaniye Camii, Şam", ("Sinan Pasha Mosque", "Beşiktaş"): "Sinan Paşa Camii, Beşiktaş",
    ("Kara Ahmed Pasha Mosque", "Topkapı"): "Gazi Ahmet Paşa Camii", ("Selimiye Mosque", "Konya"): "Sultan Selim Camii, Konya",
    ("Karađoz Bey Mosque", "Mostar"): "Karagöz Bey Camii", ("Cihangir Mosque", "Cihangir"): "Cihangir Camii",
    ("İskender Pasha Mosque", "Kanlıca"): "İskender Paşa Camii, Kanlıca", ("Hürrem Çavus Mosque", "Karagümrük"): "Hürrem Çavuş Camii",
    ("Sultaniya Mosque", "Karapınar"): "Sultan Selim Camii, Karapınar", ("Rüstem Pasha Mosque", "Bolvadin"): "Bolvadin Rüstem Paşa Camii",
    ("Rüstem Pasha Mosque", "Tahtakale"): "Rüstem Paşa Camii", ("Mihrimah Sultan Mosque", "Edirnekapı"): "Edirnekapı Mihrimah Sultan Camii",
    ("Ferruh Kethüda Mosque", "Balat"): "Ferruh Kethüda Camii", ("Sokollu Mehmed Pasha Mosque", "Lüleburgaz"): "Sokullu Mehmet Paşa Camii, Lüleburgaz",
    ("Piyale Pasha Mosque", "Kasımpaşa"): "Piyale Paşa Camii", ("Cenabi Ahmed Pasha Mosque", "Ankara"): "Cenabi Ahmet Paşa Camii",
    ("Firdevs Pasha Mosque", "Isparta"): "Firdevs Bey Camii", ("Behram Pasha Mosque", "Diyarbakır"): "Behram Paşa Camii",
    ("Lala Hüseyin Pasha Mosque", "Kütahya"): "Lala Hüseyin Paşa Camii", ("Osman Shah Mosque", "Trikala"): "Osman Şah Camii",
    ("Köse Hüsrev Pasha Mosque", "Van"): "Hüsrev Paşa Camii, Van", ("Sokollu Mehmed Pasha Mosque", "Kadırgalimanı"): "Kadırga Sokullu Mehmet Paşa Camii",
    ("Selimiye Mosque", "Edirne"): "Selimiye Camii, Edirne", ("Defterdar Mustafa Çelebi Mosque", "Edirne"): "Defterdar Mustafa Paşa Camii",
    ("Semiz Ali Pasha Mosque", "Babaeski"): "Semiz Ali Paşa Camii, Babaeski", ("Atik Valide Mosque", "Üsküdar"): "Atik Valide Camii",
    ("Molla Çelebi Mosque", "Beyoğlu"): "Molla Çelebi Camii", ("Pertev Pasha Mosque", "İzmit"): "Pertev Paşa Camii",
    ("Sokollu Kasim Bey Mosque", "Havsa"): "Sokullu Mehmet Paşa Camii, Havsa", ("Sokollu Mehmed Pasha Mosque", "Azapkapı"): "Sokullu Mehmet Paşa Camii, Azapkapı",
    ("Ferhad Pasha Mosque", "Çatalca"): "Ferhat Paşa Camii, Çatalca", ("Haci Ahmed Pasha Mosque", "Kayseri"): "Hacı Ahmet Paşa Camii",
    ("Zal Mahmud Pasha Mosque", "Eyüp"): "Zal Mahmut Paşa Camii", ("Kılıç Ali Pasha Mosque", "Tophane"): "Kılıç Ali Paşa Camii",
    ("Şemsi Pasha Mosque", "Üsküdar"): "Şemsi Paşa Camii", ("Muradiye Mosque", "Manisa"): "Muradiye Camii, Manisa",
    ("Mehmed Agha Mosque", "Çarşamba"): "Mehmet Ağa Camii", ("Mesih Mehmed Pasha Mosque", "Hırka-i Şerif"): "Mesih Mehmet Paşa Camii",
    ("Nişancı Mehmed Pasha Mosque", "Karagümrük"): "Nişancı Mehmet Paşa Camii, Atikali", ("Hacı Evhad Mosque", "Yedikule"): "Hacı Evhad Camii",
    ("Ramazan Efendi Mosque", "Kocamustafapaşa"): "Ramazan Efendi Camii", ("Melek Ahmed Pasha Mosque", "Diyarbakır"): "Melik Ahmet Paşa Camii",
}
TUR_EKI = r"(Camii|Mescidi|Medresesi|Darülkurrası|Darülhadis Medresesi|Sıbyan Mektebi|İmareti|İmarethanesi|Tabhanesi|Hamamı|Hanı|Arastası|Türbesi|Kervansarayı|Çeşmesi|Sebili|Fırını|Tekkesi|Dua Kubbesi|Külliyesi)"


def anahtar(ad):  # banı adı: "Payas Sokullu Mehmet Paşa Hamamı" → "sokullu mehmet pasa"
    ad = re.sub(r",.*$", "", ad); ad = re.sub(r"\b(Payas|Edirnekapı|Kadırga|Bolvadin)\b", "", ad)
    ad = re.split(TUR_EKI, ad)[0]
    s = unicodedata.normalize("NFKD", ad.lower().replace("ı", "i")); s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z]+", s))


def mesafe(a, b):
    return 6371000 * math.hypot(math.radians(a[2] - b[2]) * math.cos(math.radians(a[3])), math.radians(a[3] - b[3]))


yil = {}
for line in open("tools/sinan_camileri.txt", encoding="utf-8"):
    if line.startswith("#") or not line.strip(): continue
    ad, yer, tarih = [x.strip() for x in line.split("|")]
    k = ESLESME.get((ad, yer.split(",")[0].strip()))
    if not k or k not in AD: continue
    y = int(re.search(r"1\d{3}", tarih).group())
    for e in AD[k]: yil[e[0]] = y
sinan = len(yil)
# Wikidata yapım yılları (Sinan listesi öncelikli)
if os.path.exists("tools/.cache/wd_p571_mimar.json"):
    q2ke = {}
    for k, q in W.items(): q2ke.setdefault(q, []).append(int(k))
    for b in json.load(open("tools/.cache/wd_p571_mimar.json")):
        q = b["i"]["value"].rsplit("/", 1)[-1]; m = re.match(r"(-?\d+)-", b["t"]["value"])
        if not m: continue
        for k in q2ke.get(q, []):
            if k not in yil: yil[k] = int(m.group(1))
wd = len(yil) - sinan
# Külliye yayılımı
idx = {e[0]: e for e in E}
yayilan = 0
for k, y in list(yil.items()):
    a = idx[k]; ka = anahtar(a[1])
    if len(ka) < 5: continue
    for e in E:
        if e[0] in yil or abs(e[3] - a[3]) > 0.005 or abs(e[2] - a[2]) > 0.007: continue
        if anahtar(e[1]) == ka and mesafe(a, e) <= 400: yil[e[0]] = y; yayilan += 1
json.dump({str(k): v for k, v in yil.items()}, open("data/heritage/kesin_yil.json", "w", encoding="utf-8"), separators=(",", ":"))
print(f"Sinan listesi {sinan}, Wikidata {wd}, külliye yayılımı {yayilan}; toplam {len(yil)}")
