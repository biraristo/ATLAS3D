#!/usr/bin/env python3
"""ATLAS3D araç kataloğu üretici.

Girdi : tools/fetch_eea.py ile indirilen AB Çevre Ajansı (EEA) "CO2 emissions from new passenger cars"
        veri setinin yıllık özetleri (tools/.cache/eea/<yıl>.json). Veri, AB'de yeni tescil edilen her binek
        aracın tip onayındaki kütle, motor hacmi, güç, yakıt türü ve resmi CO2 / tüketim değerlerini içerir.
Çıktı: data/vehicles/index.json (markalar) ve data/vehicles/<marka>.json (model → yıl → motor seçenekleri).

Kurallar (uydurma yok):
  - Her değer EEA kaydından gelir; model adları temizlenir ve birleştirilir, sayılar değişmez.
  - Tüketim: 2021+ için WLTP tüketim alanı (Fc), yoksa WLTP CO2'den; 2010-2020 için NEDC CO2'den
    yakıt türüne göre karbon dengesi katsayısıyla litreye çevrilir (benzin 23,5 · dizel 26,4 · LPG 16,3 g/km → L/100 km).
  - Türkiye'de farklı adla satılan aynı araçlar için yalnızca açık eşleştirme yapılır (ör. Fiat Tipo = Egea).
"""
import json, os, re, sys, unicodedata, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache', 'eea')
OUT = os.path.join(ROOT, 'data', 'vehicles')

def strip_acc(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))

# ---------- Marka ----------
MAKE_RULES = [
    (r'^(VOLKSWAGEN|VW\b|VOLKSWAGENVW)', 'Volkswagen'), (r'^MERCEDES', 'Mercedes-Benz'), (r'^(SKODA|\?KODA)', 'Škoda'),
    (r'^(OPEL|VAUXHALL)', 'Opel'), (r'^FIAT', 'Fiat'), (r'^ABARTH', 'Abarth'), (r'^CITROEN DS', 'DS'), (r'^CITROEN', 'Citroën'),
    (r'^(BMW|B\.M\.W)', 'BMW'), (r'^(LAND ?ROVER|RANGE ROVER)', 'Land Rover'), (r'^JAGUAR LAND ROVER', 'JLR'),
    (r'^JAGUAR', 'Jaguar'), (r'^MITSUBISHI', 'Mitsubishi'), (r'^HYUNDAI', 'Hyundai'), (r'^LANCIA', 'Lancia'),
    (r'^ALFA', 'Alfa Romeo'), (r'^TESLA', 'Tesla'), (r'^(AUDI|A\.U\.D\.I)', 'Audi'), (r'^FORD', 'Ford'),
    (r'^MG\b', 'MG'), (r'^(SSANGYONG|KGM)', 'KGM (SsangYong)'), (r'^LYNK', 'Lynk & Co'), (r'^RENAULT', 'Renault'),
    (r'^PEUGEOT', 'Peugeot'), (r'^TOYOTA', 'Toyota'), (r'^NISSAN', 'Nissan'), (r'^DACIA', 'Dacia'), (r'^KIA', 'Kia'),
    (r'^SEAT', 'Seat'), (r'^CUPRA', 'Cupra'), (r'^VOLVO', 'Volvo'), (r'^SUZUKI', 'Suzuki'), (r'^MAZDA', 'Mazda'),
    (r'^MINI', 'MINI'), (r'^HONDA', 'Honda'), (r'^JEEP', 'Jeep'), (r'^SMART', 'Smart'), (r'^PORSCHE', 'Porsche'),
    (r'^CHEVROLET', 'Chevrolet'), (r'^LEXUS', 'Lexus'), (r'^DS\b', 'DS'), (r'^SUBARU', 'Subaru'), (r'^BYD', 'BYD'),
    (r'^POLESTAR', 'Polestar'), (r'^MASERATI', 'Maserati'), (r'^CHERY', 'Chery'), (r'^OMODA', 'Omoda'),
    (r'^JAECOO', 'Jaecoo'), (r'^LEAPMOTOR', 'Leapmotor'), (r'^TOGG', 'Togg'), (r'^ALPINE', 'Alpine'),
    (r'^INFINITI', 'Infiniti'), (r'^SAAB', 'Saab'), (r'^DAIHATSU', 'Daihatsu'), (r'^LADA', 'Lada'), (r'^XPENG', 'XPeng'),
    (r'^CHRYSLER', 'Chrysler'), (r'^DODGE', 'Dodge'), (r'^ISUZU', 'Isuzu'), (r'^GEELY', 'Geely'), (r'^ZEEKR', 'Zeekr'),
    (r'^NIO\b', 'NIO'), (r'^SKYWELL', 'Skywell'), (r'^DFSK', 'DFSK'), (r'^HONGQI', 'Hongqi'), (r'^GWM|^ORA\b|^GREAT WALL', 'GWM'),
]
MAKE_RE = [(re.compile(p), n) for p, n in MAKE_RULES]
JAGUAR_MODELS = re.compile(r'^(E-?PACE|F-?PACE|I-?PACE|XE|XF|XJ|F-?TYPE)')
# Türkiye'de satılan / satılmış markalar: düşük AB tescil sayısında da tutulur
TR_PRIORITY = {'Togg', 'Chery', 'Omoda', 'Jaecoo', 'BYD', 'Leapmotor', 'MG', 'Skywell', 'KGM (SsangYong)', 'Geely', 'XPeng', 'Hongqi', 'Zeekr', 'GWM', 'DFSK'}

def canon_make(mk):
    m = strip_acc((mk or '').strip().upper())
    for rx, name in MAKE_RE:
        if rx.search(m): return name
    return None

# ---------- Model ----------
DROP_MAKES = {'Chrysler', 'DFSK', 'GWM', 'Geely', 'Hongqi'}  # AB verisinde ad karmaşası çok, Türkiye'de pratikte yok
DROP_FIRST = {'NEW', 'NUOVA', 'NUOVO', 'NOUVELLE', 'NOUVEAU', 'NEUE', 'NEUER', 'NEUES', 'NUEVO', 'NUEVA', 'ALL', 'THE', 'N', 'NOVA', 'NOVO', 'NOWY', 'NOWA'}
BAD = {'', 'SUV', 'GRAND', 'SERIE', 'SERIES', 'REIHE', 'CLASSE', 'CLASS', 'KLASSE', 'CLASE', 'MODEL', 'RANGE', 'LAND', 'X', 'XREIHE', 'SERIEX', 'XSERIES', 'PART', 'KOMBI', 'CAR', 'PKW', 'M1', 'AUTO', 'VAN', 'NC5', 'NGC4PI'}
# Bir sonraki kelimeyle birlikte model adı olanlar (ilk kelime → kabul edilen ikinci kelimeler)
TWO = {
    'YARIS': {'CROSS'}, 'AYGO': {'X'}, 'GRAND': {'SCENIC', 'CHEROKEE', 'VITARA', 'C4', 'C-MAX', 'TOURNEO', 'ESPACE', 'MODUS', 'PICASSO'},
    'RANGE': {'ROVER'}, 'LAND': {'CRUISER'}, 'SANTA': {'FE'}, 'MODEL': {'3', 'S', 'X', 'Y'}, 'GRANDLAND': {'X'},
    'CROSSLAND': {'X'}, 'SPACE': {'STAR'}, 'C4': {'PICASSO', 'CACTUS', 'X', 'AIRCROSS', 'SPACETOURER'},
    'C3': {'AIRCROSS', 'PICASSO'}, 'C5': {'AIRCROSS', 'X'}, 'ECLIPSE': {'CROSS'}, 'URBAN': {'CRUISER'},
    'GOLF': {'SPORTSVAN', 'PLUS'}, 'COROLLA': {'CROSS'}, 'S': {'CROSS'}, 'SX4': {'S-CROSS'}, 'TOURNEO': {'CONNECT', 'COURIER', 'CUSTOM'},
    'TRANSIT': {'CONNECT', 'COURIER', 'CUSTOM'}, 'MEGANE': {'SCENIC'}, 'MERIVA': set(), 'ZAFIRA': {'TOURER', 'LIFE'},
    'DISCOVERY': {'SPORT'}, 'VITO': {'TOURER'}, 'JUMPY': {'SPACETOURER'}, 'MULTIVAN': set(), 'IONIQ': {'5', '6', '9'},
    'C-MAX': set(), 'B-MAX': set(), 'PROACE': {'CITY', 'VERSO'}, 'ID': {'3', '4', '5', '7', 'BUZZ'}, 'ATTO': {'2', '3'},
    'SEAL': {'U'}, 'TIGGO': {'4', '7', '8', '9'}, 'OMODA': {'5', '9'}, 'JAECOO': {'5', '7', '8'}, 'E': {'NIRO'},
    'POLO': set(), 'PASSAT': {'CC'}, 'XSARA': {'PICASSO'}, 'C': {'ELYSEE', 'ZERO', 'CROSSER'}, 'CEE': {'D'},
    'SCENIC': set(), 'CLIO': set(), 'KANGOO': set(), 'MX': {'5', '30'}, 'CX': {'3', '30', '5', '60', '80'},
}
THREE = {('RANGE', 'ROVER'): {'EVOQUE', 'SPORT', 'VELAR'}, ('PROACE', 'CITY'): {'VERSO'}}
GLUE_LETTERS = re.compile(r'^[A-Z]{1,2}$')

def clean_tokens(cn, make):
    s = strip_acc((cn or '').upper())
    s = s.replace('Ã', '').replace('Š', 'S')
    s = re.sub(r"[’'`\"]", '', s)
    s = re.sub(r'[,/;:()+*]|\s-\s|\.(?!\d)', ' ', s)
    # Marka adını baştan sil (bitişik yazılmış olsa da: TOYOTAYARIS)
    words = {'Volkswagen': ['VOLKSWAGEN', 'VW'], 'Mercedes-Benz': ['MERCEDES-BENZ', 'MERCEDES', 'BENZ', 'MB'], 'Škoda': ['SKODA'],
             'Opel': ['OPEL', 'VAUXHALL'], 'Citroën': ['CITROEN'], 'Land Rover': ['LAND ROVER', 'LANDROVER'], 'Alfa Romeo': ['ALFA ROMEO', 'ALFA'],
             'KGM (SsangYong)': ['SSANGYONG', 'KGM'], 'Lynk & Co': ['LYNK&CO', 'LYNK & CO'], 'Omoda': [], 'Jaecoo': []}.get(make, [strip_acc(make.upper())])
    changed = True
    while changed:
        changed = False; s = s.strip()
        for w in words:
            if s.startswith(w) and (len(s) == len(w) or not s[len(w)].isalpha() or len(s) >= len(w) + 2):
                s = s[len(w):].lstrip(' -.'); changed = True
    return s.split()

def canon_model(cn, make):
    t = clean_tokens(cn, make)
    while t and t[0] in DROP_FIRST: t = t[1:]
    if not t: return None
    if make == 'BMW': return bmw_model(t)
    if make == 'Mercedes-Benz': return merc_model(t)
    a = t[0]
    # "I 30" → I30, "C 3" → C3, "EX 30" → EX30 (Kona/Kauai gibi tekrarlar ayıklanır)
    if len(t) > 1 and GLUE_LETTERS.match(a) and re.match(r'^\d{1,3}[A-Z]?$', t[1]) and not (a in TWO and t[1] in TWO[a] and a in ('MODEL', 'ID', 'MX', 'CX')):
        a = a + t[1]; t = [a] + t[2:]
    if a in ('MODEL', 'ID', 'MX', 'CX') and len(t) > 1 and t[1] in TWO[a]:
        a = f'{a}-{t[1]}' if a in ('MX', 'CX') else f'{a} {t[1]}'; t = [a] + t[2:]
    if a.startswith('ID.') or re.match(r'^ID\d', a): a = 'ID.' + a.replace('ID.', '').replace('ID', '')
    a = {'CHR': 'C-HR', 'XTRAIL': 'X-TRAIL', 'TROC': 'T-ROC', 'TCROSS': 'T-CROSS', 'CELYSEE': 'C-ELYSEE', 'C-ELYSSEE': 'C-ELYSEE', 'C-ELYS': 'C-ELYSEE',
         'GOLFPLUS': 'GOLF PLUS', 'MEGANESCENIC': 'SCENIC', 'TUCSONIX35': 'TUCSON', 'TUCSONIX35LM': 'TUCSON', 'I30I30CW': 'I30', 'SANTAFE': 'SANTA FE',
         'TIGGO7': 'TIGGO 7', 'TIGGO8': 'TIGGO 8', 'TIGGO4': 'TIGGO 4', 'TIGGO9': 'TIGGO 9', 'OMODA5': 'OMODA 5', 'JAECOO7': 'JAECOO 7',
         'IONIQ5': 'IONIQ 5', 'IONIQ6': 'IONIQ 6', 'KAUAI': 'KONA', 'UP': 'UP!', 'E-NIRO': 'NIRO', 'ATTO3': 'ATTO 3', 'C-ZERO': 'C-ZERO'}.get(a, a)
    if len(t) > 1 and a in TWO and t[1] in TWO[a]:
        b = t[1]
        if a in ('C',): return f'C-{b}'
        if a == 'E' and b == 'NIRO': return 'NIRO'
        name = f'{a} {b}'
        if len(t) > 2 and (a, b) in THREE and t[2] in THREE[(a, b)]: name += ' ' + t[2]
        if name in ('MEGANE SCENIC',): return 'SCENIC'
        if name in ('GOLF PLUS',): return 'GOLF PLUS'
        if name == 'TUCSON IX35': return 'TUCSON'
        return ALIAS.get(name, name)
    a = re.sub(r'(HYBRID|HEV|PHEV|PLUGIN)$', '', a) or a
    if make in ('Lexus', 'Infiniti'):
        m = re.match(r'^(LBX|[A-Z]{2})\d', a)
        if m: a = m.group(1)
        if make == 'Lexus' and a in ('RXL',): a = 'RX'
    if make == 'Mazda' and re.match(r'^[2356]$', a): return 'MAZDA' + a
    if make == 'Mazda' and a == '6E': return 'MAZDA6'
    if make == 'Smart' and a.startswith('FORTWO'): return 'FORTWO'
    if make == 'Smart' and a in ('EQ', 'ELECTRIC'): return 'FORTWO'
    if make == 'Audi' and re.match(r'^(A\d)(SPORTBACK|CABRIOLET|AVANT|LIMOUSINE|ALLROAD.*|L)$', a): return a[:2]
    if make == 'Peugeot' and re.match(r'^N\d{3,4}$', a): a = a[1:]
    if make == 'DS' and not re.match(r'^DS\d', a): return None
    if a in ALIAS: return ALIAS[a]  # None: model değil
    if a in DROP_MODELS: return None
    if a in ('TIPO', 'EGEA'): return 'EGEA / TIPO'
    if a == 'THALIA': return 'SYMBOL'
    if a == '206' and len(t) > 1 and t[1] == '+': return '206+'
    if a in BAD or len(a) < 2 and not a.isdigit(): return None
    if re.match(r'^\d+(\.\d)?$', a) and float(a) < 10: return None  # yalnızca motor hacmi yazılmış
    return a

BMW_SERIES = re.compile(r'^(\d)(\d\d)(I|D|E|XE|IX|DX|ED|SD|XD|EX)?$')
def bmw_model(t):
    a = t[0]
    if a in ('SERIE', 'SERIES', 'REIHE') and len(t) > 1 and t[1].isdigit(): return f'{t[1]} SERISI'
    m = re.match(r'^(\d)(ER)?(REIHE|SERIES)?$', a)
    if m and (m.group(2) or m.group(3) or (len(t) > 1 and t[1] in ('ER', 'REIHE', 'SERIES', 'SERIE'))): return f'{m.group(1)} SERISI'
    m = BMW_SERIES.match(a)
    if m: return f'{m.group(1)} SERISI'
    if re.match(r'^(X[1-7]M?|IX[1-3]?|I[3-8]|Z4|M[2-8])$', a): return a
    if re.match(r'^X[1-7]', a): return a[:2]
    return None

MERC = re.compile(r'^(CLA|CLS|CLK|GLA|GLB|GLC|GLE|GLK|GLS|GL|ML|SLC|SLK|SL|EQA|EQB|EQC|EQE|EQS|EQV|A|B|C|E|S|G|V|R|X)(\d{2,3})?[A-Z]*$')
def merc_model(t):
    a = t[0]
    if a in ('CLASSE', 'CLASS', 'KLASSE', 'CLASE') and len(t) > 1: a = t[1]
    a = re.sub(r'-?(KLASSE|CLASS|CLASSE)$', '', a)
    if a in ('VITO', 'VIANO', 'CITAN', 'T', 'MARCO'):
        return {'T': 'T-SERISI'}.get(a, a) if a != 'MARCO' else None
    if a == 'AMG' and len(t) > 1: a = t[1]
    m = MERC.match(a)
    if not m: return None
    cls = m.group(1)
    if cls in ('X', 'R'): return None
    if cls == 'GLK': cls = 'GLK'
    return f'{cls}-SERISI' if len(cls) == 1 else cls

# Gözlenen yazım/varyant karmaşası → tek model adı (veri setindeki gerçek yazımlardan derlendi)
ALIAS = {'TRAFFIC': 'TRAFIC', 'BERL': 'BERLINGO', 'E-BERLINGO': 'BERLINGO', 'E-C3': 'C3', 'E-C4': 'C4', 'E-C4 X': 'C4 X', 'E-GOLF': 'GOLF', 'CORSA-E': 'CORSA',
         'COMBO-C': 'COMBO', 'MERIVA-A': 'MERIVA', 'MERIVA-B': 'MERIVA', 'VIVARO-B': 'VIVARO', 'KARLROCKS': 'KARL', 'MOKKAX': 'MOKKA', 'CROSSLAND X': 'CROSSLAND',
         'CROSSLANDX': 'CROSSLAND', 'GRANDLAND X': 'GRANDLAND', 'GRANDLANDX': 'GRANDLAND', 'INSIG': 'INSIGNIA', 'PARTNEROD': 'PARTNER', '308SW': '308',
         'GRANDC-MAX': 'GRAND C-MAX', 'CIVIC5DR': 'CIVIC', 'CRV': 'CR-V', 'CRV2': 'CR-V', 'I.10': 'I10', 'CRUCE': 'CRUZE', 'GRANDCHEROKEE': 'GRAND CHEROKEE',
         'KARANDO': 'KORANDO', 'KORNADO': 'KORANDO', 'KORANDOACTYON': 'KORANDO', 'CX5': 'CX-5', 'MX5': 'MX-5', 'OUTLAER': 'OUTLANDER', 'ECLIPSE': 'ECLIPSE CROSS',
         'SPACE': 'SPACE STAR', 'SHOGUN': 'PAJERO', 'MONTERO': 'PAJERO', 'IBIA': 'IBIZA', 'IBIZAST': 'IBIZA', 'ALTEAXL': 'ALTEA', 'EXEOST': 'EXEO', 'RAPIDE': 'RAPID',
         'GF-ALTO': 'ALTO', 'GRANDVITARA': 'GRAND VITARA', 'SWIFTSPORT': 'SWIFT', 'SX4SUUKI': 'SX4', 'SX4SUZUKI': 'SX4', 'SX4SUZUKISX4': 'SX4', 'IQ2': 'IQ',
         'HIGH': 'UP!', 'MOVE': 'UP!', 'TAKE': 'UP!', 'MULTIVANSTARTLINE': 'MULTIVAN', 'PASSATCC': 'PASSAT CC', 'A8L': 'A8', 'D0LPH1N': 'DOLPHIN', 'E6Y': 'E6',
         'DISCO-Y': 'DISCOVERY', 'DISCOVERY4': 'DISCOVERY', 'FREELANDER2': 'FREELANDER', 'R-ROVER': 'RANGE ROVER', 'RANGEROVER': 'RANGE ROVER', 'RR': 'RANGE ROVER',
         'RROVER': 'RANGE ROVER', 'RANGEROVEREVOQUE': 'RANGE ROVER EVOQUE', 'EVOQUE': 'RANGE ROVER EVOQUE', 'RANGEROVERSPORT': 'RANGE ROVER SPORT',
         'RROVERSPORT': 'RANGE ROVER SPORT', 'VELAR': 'RANGE ROVER VELAR', 'GRANDE': 'PUNTO', 'ED': 'CEED', 'EDCEED': 'CEED', 'CEE': 'CEED', 'CEE D': 'CEED',
         'CEEDSW': 'CEED', 'PRO_CEE': 'PROCEED', 'PRO': 'PROCEED', 'PICANTOMORNING': 'PICANTO', 'PICANTOSA': 'PICANTO', 'SPORTAGESLSLS': 'SPORTAGE', 'SL': 'SPORTAGE',
         'JB': 'RIO', 'FX30D': 'FX', 'Q30S': 'Q30', 'CAPTURD-QUE': 'CAPTUR', 'CUORECHARADEMIRA': 'CUORE', 'E-NV200': 'NV200', 'C3PICASSO': 'C3 PICASSO',
         'C4PICASSO': 'C4 PICASSO', 'ASTRASPORTSTOURER': 'ASTRA', 'BOXSTERS': 'BOXSTER', 'CAYENNEDIESEL': 'CAYENNE', 'CAYENNES': 'CAYENNE',
         '911CARRERA': '911', '911CARRERA4S': '911', '911CARRERAGTS': '911', 'PANAMERA4S': 'PANAMERA', 'COOPERCABRIO': 'COOPER', 'JOHNCOOPERWORKS': 'COOPER',
         'JOHN': 'COOPER', 'JCW': 'COOPER', 'ONE': 'COOPER', 'FIRST': 'COOPER', 'RAY': 'COOPER', 'SEAL6': 'SEAL 6', 'JEACOO': 'JAECOO 7', 'JAECOO07': 'JAECOO 7', 'JAECOO5': 'JAECOO 5', 'OMODA9': 'OMODA 9', 'E-RIFTER': 'RIFTER', 'JA': None, 'DOLPHIN-DOLPHIN-BYD': 'DOLPHIN', 'DOBLAS': 'DOBLO', 'LANDCRUISER': 'LAND CRUISER', 'LANDCRUISER150': 'LAND CRUISER', 'RAV': 'RAV4',
         'KONAKAUAI': 'KONA', 'I30N': 'I30', '500C': '500', 'H-1STAREXGRAND': 'H-1', 'H-1STAREXGRANDSTAREX': 'H-1', 'H1': 'H-1', 'SANTA': 'SANTA FE',
         'YARISHYBRID': 'YARIS', 'GT86': '86', 'IQ': 'IQ'}
# Model sayılmayan / belirsiz adlar
DROP_MODELS = {'UNKNOWN', 'VOITURE', 'CITROEN', 'FIAT', 'JEEP', 'LANCIA', 'LEXUS', 'JAGUAR', 'URBAN', 'GR', 'SPORT', 'RS', 'NDS', '3008-5008', 'OUBHZM',
               'HORIZON', 'C-MAN', 'KG', 'RJ', 'EX', 'EX-2', 'MZ', 'NZ', 'M300', 'MOTOR', 'GREAT', 'HAVAL', 'CUPRA', 'ABARTH', '987', 'AFIRA', 'ELECTRIC'}
# Ana modelle karışmaması gereken ayrı modeller (birleştirme kuralının dışında)
KEEP_DISTINCT = {'500X', '500L', 'C4 X', 'C5 X', 'AYGO X', 'Q30', 'QX30', 'Q50', 'Q60', 'Q70', 'QX70', 'RS3', 'RS4', 'RS5', 'RS6', 'RS7', 'SQ2', 'SQ5',
                 'SQ7', 'SQ8', 'TTS', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'I30', 'I20', 'I10', 'I40', 'GT86', 'XCEED', 'PROCEED', 'CROSSTREK', 'IONIQ 5', 'IONIQ 6',
                 'CORSA', 'MEGANE', 'SCENIC', 'GRAND SCENIC', 'C3 PICASSO', 'C4 PICASSO', 'C3 AIRCROSS', 'C4 AIRCROSS', 'C5 AIRCROSS', 'C4 CACTUS', 'C4 SPACETOURER',
                 'GRAND C-MAX', 'GRAND C4', 'TOURNEO CONNECT', 'TOURNEO COURIER', 'TOURNEO CUSTOM', 'TRANSIT CONNECT', 'TRANSIT COURIER', 'TRANSIT CUSTOM',
                 'SPACE STAR', 'ECLIPSE CROSS', 'YARIS CROSS', 'COROLLA CROSS', 'GOLF PLUS', 'GOLF SPORTSVAN', 'PASSAT CC', 'PROACE CITY', 'PROACE CITY VERSO',
                 'PROACE VERSO', 'SEAL U', 'SEAL 6', 'DISCOVERY SPORT', 'RANGE ROVER EVOQUE', 'RANGE ROVER SPORT', 'RANGE ROVER VELAR', 'SX4 S-CROSS',
                 'GRAND VITARA', 'GRAND CHEROKEE', 'ZAFIRA TOURER', 'ZAFIRA LIFE', 'JUMPY SPACETOURER', 'VERSO-S', 'CLIO', 'CAPTUR', 'MOKKA', 'KARL', 'ASTRA', 'C4'}

DISPLAY = {'EGEA / TIPO': 'Egea / Tipo', 'COOPER': 'Hatch / Cabrio (Cooper, One)', 'MAZDA2': 'Mazda2', 'MAZDA3': 'Mazda3', 'MAZDA5': 'Mazda5',
           'MAZDA6': 'Mazda6', 'FORTWO': 'Fortwo', 'FORFOUR': 'Forfour', 'GT-R': 'GT-R', 'IONIQ': 'Ioniq', 'GRAND C-MAX': 'Grand C-Max', 'B-MAX': 'B-Max',
           'C-MAX': 'C-Max', 'S-MAX': 'S-Max', 'H-1': 'H-1', 'ZOE': 'Zoe', 'KA': 'Ka', 'MII': 'Mii', 'ION': 'iOn', 'IQ': 'iQ', 'I-MIEV': 'i-MiEV',
           'I3': 'i3', 'I4': 'i4', 'I5': 'i5', 'I7': 'i7', 'I8': 'i8', 'IX': 'iX', 'IX1': 'iX1', 'IX2': 'iX2', 'IX3': 'iX3', 'I10': 'i10', 'I20': 'i20',
           'I30': 'i30', 'I40': 'i40', 'IX20': 'ix20', 'IX35': 'ix35', 'I800': 'i800', 'FOX': 'Fox', 'EOS': 'Eos', 'HAN': 'Han', 'RIO': 'Rio', 'CEED': "Ceed (cee'd)",
           'PROCEED': "ProCeed (pro_cee'd)", 'ONE': 'One', 'SEAL 6': 'Seal 6', 'UP!': 'up!', 'C-HR': 'C-HR', 'C-ELYSEE': 'C-Elysée', 'ID.3': 'ID.3', 'ID.4': 'ID.4', 'ID.5': 'ID.5',
           'ID.7': 'ID.7', 'ID.BUZZ': 'ID. Buzz', 'T-ROC': 'T-Roc', 'T-CROSS': 'T-Cross', 'X-TRAIL': 'X-Trail', 'SYMBOL': 'Symbol'}

def display_model(name, make):
    if name in DISPLAY: return DISPLAY[name]
    if name.endswith(' SERISI'): return name.replace(' SERISI', ' Serisi')
    if name.endswith('-SERISI'): return name.replace('-SERISI', '-Serisi')
    out = []
    for w in name.split(' '):
        if re.search(r'\d', w) or len(w) <= 3 or w in ('RAV4', 'XCEED', 'PCEED'): out.append(w)
        else: out.append('-'.join(p if len(p) <= 2 else p.capitalize() for p in w.split('-')))
    return ' '.join(out)

# ---------- Gövde (hava direnci için) ----------
SUV = set('''CAPTUR|KADJAR|AUSTRAL|ARKANA|KOLEOS|DUSTER|BIGSTER|SYMBIOZ|RAFALE|T-ROC|T-CROSS|TIGUAN|TOUAREG|TAIGO|ID.4|ID.5|KODIAQ|KAROQ|KAMIQ
|ENYAQ|ELROQ|YETI|ATECA|ARONA|TARRACO|FORMENTOR|TERRAMAR|2008|3008|5008|4008|4007|C-CROSSER|JUKE|QASHQAI|X-TRAIL|ARIYA|TUCSON|KONA|BAYON|IX35
|SPORTAGE|NIRO|STONIC|SORENTO|EV3|EV6|EV9|XCEED|SELTOS|C-HR|RAV4|HIGHLANDER|BZ4X|MOKKA|CROSSLAND|GRANDLAND|FRONTERA|ANTARA|PUMA|KUGA|ECOSPORT|EDGE
|EXPLORER|MUSTANG|Q2|Q3|Q4|Q5|Q6|Q7|Q8|SQ2|SQ5|SQ7|SQ8|E-TRON|X1|X2|X3|X4|X5|X6|X7|IX|IX1|IX2|IX3|GLA|GLB|GLC|GLE|GLS|GLK|ML|GL|G-SERISI|EQA|EQB|EQC
|EQE|EQS|CX-3|CX-30|CX-5|CX-60|CX-7|CX-80|CX-9|MX-30|VITARA|S-CROSS|SX4|JIMNY|HR-V|CR-V|ZR-V|OUTLANDER|ASX|XC40|XC60|XC70|XC90|EX30|EX40|EX90|C40|COMPASS
|RENEGADE|AVENGER|CHEROKEE|WRANGLER|PATRIOT|DEFENDER|DISCOVERY|FREELANDER|E-PACE|F-PACE|I-PACE|CAYENNE|MACAN|NX|RX|UX|LBX|ZS|HS|EHS|MARVEL|TANG|SEALION
|T10X|KORANDO|TIVOLI|REXTON|TORRES|KYRON|ACTYON|FORESTER|XV|CROSSTREK|SOLTERRA|TONALE|STELVIO|DS7|500X|COUNTRYMAN|ACEMAN|SEDICI|600|TERRANO|SPRING
|JOGGER|C10|B10|LEVANTE|GRECALE|CAPTIVA|TRAX|MURANO|PATHFINDER|PAJERO|ECLIPSE CROSS|SANTA FE|IONIQ 5|YARIS CROSS|LAND CRUISER|COROLLA CROSS|URBAN CRUISER
|GRAND VITARA|GRAND CHEROKEE|MODEL Y|MODEL X|RANGE ROVER|RANGE ROVER EVOQUE|RANGE ROVER SPORT|RANGE ROVER VELAR|DISCOVERY SPORT|TIGGO 4|TIGGO 7|TIGGO 8
|TIGGO 9|OMODA 5|OMODA 9|JAECOO 5|JAECOO 7|JAECOO 8|ATTO 3|ATTO 2|SEAL U|SX4 S-CROSS|C3 AIRCROSS|C4 AIRCROSS|C5 AIRCROSS|XC40|QX30|QX70|FX'''.replace('\n', '').split('|'))
VAN = {'KANGOO', 'BERLINGO', 'PARTNER', 'RIFTER', 'DOBLO', 'CADDY', 'TRANSIT', 'TRANSIT CONNECT', 'TRANSIT COURIER', 'TRANSIT CUSTOM', 'TOURNEO',
       'TOURNEO CONNECT', 'TOURNEO COURIER', 'TOURNEO CUSTOM', 'COMBO', 'PROACE', 'PROACE CITY', 'PROACE CITY VERSO', 'PROACE VERSO', 'TRAFIC', 'VITO',
       'VIANO', 'V-SERISI', 'MULTIVAN', 'CARAVELLE', 'TRANSPORTER', 'CALIFORNIA', 'CITAN', 'T-SERISI', 'TOWNSTAR', 'EXPERT', 'JUMPY', 'JUMPY SPACETOURER',
       'TRAVELLER', 'SPACETOURER', 'FIORINO', 'NEMO', 'BIPPER', 'QUBO', 'SCUDO', 'TALENTO', 'NV200', 'EVALIA', 'MASTER', 'DUCATO', 'BOXER', 'JUMPER',
       'SPRINTER', 'MOVANO', 'VIVARO', 'ZAFIRA LIFE', 'ID.BUZZ', 'STARIA', 'H-1', 'H1', 'CARNIVAL', 'SHARAN', 'ALHAMBRA', 'GALAXY', 'S-MAX',
       'ESPACE', 'TOURAN', 'ZAFIRA', 'ZAFIRA TOURER', 'C4 PICASSO', 'C4 SPACETOURER', 'GRAND C4', 'XSARA PICASSO', 'C8', '807', '5008x', 'MEGANE SCENIC', 'GRAND SCENIC'}

def body_of(model):
    if model in VAN: return 'van'
    if model in SUV: return 'suv'
    return 'car'

# ---------- Güç aktarımı ----------
FULL_HYBRID_MAKES = {'Toyota', 'Lexus', 'Honda'}
def powertrain(make, ft, fm, ec):
    ft = (ft or '').lower(); fm = (fm or '').strip().upper()
    if ft == 'electric' or fm == 'E': return 'bev'
    if fm == 'P': return 'phev'
    if fm == 'H' or 'electric' in ft:
        if fm == 'P': return 'phev'
        full = make in FULL_HYBRID_MAKES or (make in ('Renault', 'Dacia', 'Mitsubishi') and ec and 1580 <= ec <= 1610) \
            or (make in ('Hyundai', 'Kia') and ec and 1570 <= ec <= 1600) or (make == 'Ford' and ec and ec >= 2400) \
            or (make == 'Nissan' and ec and 1450 <= ec <= 1510) or make in ('BYD', 'Chery', 'Omoda', 'Jaecoo', 'MG') and ec and ec >= 1490
        return 'hev' if full else 'mhev'
    return 'ice'

def fuel_of(ft, fm):
    ft = (ft or '').lower(); fm = (fm or '').strip().upper()
    if ft == 'electric' or fm == 'E': return 'elektrik'
    if 'diesel' in ft: return 'dizel'
    if ft.startswith('lpg'): return 'lpg'
    if ft.startswith('petrol'): return 'benzin'
    return None  # CNG, E85, hidrojen: Türkiye'de pratikte yok, kataloğa alınmaz

CO2_PER_L = {'benzin': 23.5, 'dizel': 26.4, 'lpg': 16.3}

def consumption(x, fuel, pt, year):
    """(değer, esas) — benzin/dizel/lpg için L/100 km, elektrik için kWh/100 km (şebekeden)."""
    if fuel == 'elektrik':
        z = x.get('z')
        if not z or not (80 <= z <= 400): return None, None
        return round(z / 10, 1), ('w' if year >= 2019 else 'n')
    if pt == 'phev':
        return None, 'w'  # resmi "ağırlıklı" değer batarya şarjına bağlı; araç fiziğinden hesaplanır
    fc, ew, en, e0 = x.get('fc'), x.get('ew'), x.get('en'), x.get('e0')
    if fuel != 'lpg' and fc and 1.5 < fc < 30 and year >= 2021: return round(fc, 2), 'w'
    if ew and 40 < ew < 600 and year >= 2019: return round(ew / CO2_PER_L[fuel], 2), 'w'
    co2 = en or e0
    if co2 and 40 < co2 < 600: return round(co2 / CO2_PER_L[fuel], 2), 'n'
    if ew and 40 < ew < 600: return round(ew / CO2_PER_L[fuel], 2), 'w'
    return None, None

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', strip_acc(s.lower())).strip('-')

LOGOS = json.load(open(os.path.join(ROOT, 'tools', 'brand_logos.json'))) if os.path.exists(os.path.join(ROOT, 'tools', 'brand_logos.json')) else {}

def main():
    rows = []
    for y in range(2010, 2026):
        fn = os.path.join(CACHE, f'{y}.json')
        if not os.path.exists(fn): print('eksik', fn); continue
        for x in json.load(open(fn)):
            x['y'] = y; rows.append(x)
    print('kayıt', len(rows))
    # (marka, model, yıl, değişken anahtarı) → ağırlıklı toplamlar
    agg = {}
    make_regs = collections.Counter(); model_regs = collections.Counter(); dropped = collections.Counter()
    recs = []
    for x in rows:
        r = x.get('r') or 0
        if r <= 0: continue
        ct = (x.get('ct') or '').strip().upper()
        if ct and not ct.startswith('M1'): continue
        make = canon_make(x.get('mk'))
        if not make or make in DROP_MAKES: dropped['marka'] += r; continue
        model = canon_model(x.get('cn'), make if make != 'JLR' else 'Land Rover')
        if make == 'JLR':
            make = 'Jaguar' if model and JAGUAR_MODELS.match(model) else 'Land Rover'
        if make == 'Citroën' and model and re.match(r'^DS\d', model): make = 'DS'
        if make == 'Chery' and model and model.startswith('OMODA'): make = 'Omoda'
        if make == 'Chery' and model and model.startswith('JAECOO'): make = 'Jaecoo'
        if make in ('Omoda', 'Jaecoo') and model and ' ' not in model and re.match(r'^\d$', model[-1:]) and not model.startswith(make.upper()):
            pass
        if make == 'Land Rover' and model == 'ROVER': model = 'RANGE ROVER'
        if not model: dropped['model'] += r; continue
        fuel = fuel_of(x.get('ft'), x.get('fm'))
        if not fuel: dropped['yakıt'] += r; continue
        m = x.get('m')
        if not m or not (500 < m < 3600): dropped['kütle'] += r; continue
        recs.append((make, model, x)); model_regs[(make, model)] += r

    # Birleştirme: bitişik/uzatılmış yazımlar (YARISHYBRID, A4AVANT, LANDCRUISER150…) baskın modele katılır
    def compact(k): return re.sub(r'[^A-Z0-9]', '', k)
    merge = {}
    by_make = collections.defaultdict(list)
    for (mk, md), n in model_regs.items(): by_make[mk].append((md, n))
    for mk, lst in by_make.items():
        if mk in ('BMW', 'Mercedes-Benz'): continue
        lst.sort(key=lambda t: -t[1])
        for md, n in lst:
            if md in KEEP_DISTINCT: continue
            cs = compact(md)
            for big, bn in lst:
                if big == md or bn < 3 * n: continue
                cb = compact(big)
                if len(cb) < 2 or not cs.startswith(cb): continue
                rest = cs[len(cb):]
                if cs == cb or len(rest) >= 3 or (rest.isdigit() and len(cb) >= 4):
                    merge[(mk, md)] = big; break
    for (mk, md), big in list(merge.items()):
        while (mk, big) in merge: big = merge[(mk, big)]
        merge[(mk, md)] = big
    model_regs = collections.Counter()
    for make, model, x in recs:
        model = merge.get((make, model), model)
        r = x['r']
        fuel = fuel_of(x.get('ft'), x.get('fm'))
        ec = int(round(x['ec'])) if x.get('ec') else None
        pt = powertrain(make, x.get('ft'), x.get('fm'), ec)
        if fuel == 'lpg' and pt != 'ice': pt = 'ice'
        kw = int(round(x['ep'])) if x.get('ep') else None
        if kw is not None and kw < 15: kw = None
        m = x['m']
        c, basis = consumption(x, fuel, pt, x['y'])
        if c is None and pt != 'phev': dropped['tüketim'] += r; continue
        cc_bucket = int(round(ec / 100.0)) * 100 if ec else 0
        key = (make, model, x['y'], fuel, pt, cc_bucket, kw)
        a = agg.setdefault(key, collections.defaultdict(float))
        a['r'] += r; a['m'] += m * r; a['c'] += (c or 0) * r; a['cr'] += r if c else 0
        a['b_w'] += r if basis == 'w' else 0
        if x.get('mt'): a['mt'] += x['mt'] * r; a['mtr'] += r
        if x.get('at'): a['at'] += x['at'] * r; a['atr'] += r
        if x.get('z') and pt == 'phev': a['z'] += x['z'] * r; a['zr_'] += r
        if x.get('zr') and pt in ('phev', 'bev'): a['zr'] += x['zr'] * r; a['zrr'] += r
        if ec: a['ec'] += ec * r; a['ecr'] += r
        make_regs[make] += r; model_regs[(make, model)] += r
    print('elenen (tescil):', dict(dropped))

    # Model eşiği: büyük markada küçük/bozuk adlar elenir; Türkiye öncelikli markalarda tutulur
    keep_model = {}
    for (make, model), n in model_regs.items():
        lim = 30 if make in TR_PRIORITY else max(1500, make_regs[make] * 0.0004)
        keep_model[(make, model)] = n >= lim
    keep_make = {mk for mk, n in make_regs.items() if n >= 40000 or mk in TR_PRIORITY}

    tree = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
    for (make, model, y, fuel, pt, ccb, kw), a in agg.items():
        if make not in keep_make or not keep_model.get((make, model)): continue
        r = a['r']
        v = {'f': fuel, 'p': pt, 'm': int(round(a['m'] / r)), 'r': int(r)}
        if kw: v['kw'] = kw
        if a['ecr']: v['cc'] = int(round(a['ec'] / a['ecr']))
        if a['cr']: v['c'] = round(a['c'] / a['cr'], 1 if fuel == 'elektrik' else 2)
        v['b'] = 'w' if a['b_w'] >= r / 2 else 'n'
        if a['mtr']: v['mt'] = int(round(a['mt'] / a['mtr']))
        if a['atr']: v['at'] = int(round(a['at'] / a['atr']))
        if a['zr_']: v['z'] = int(round(a['z'] / a['zr_']))
        if a['zrr']: v['er'] = int(round(a['zr'] / a['zrr']))
        tree[make][model][y].append(v)

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.json'): os.remove(os.path.join(OUT, f))
    index = []
    total_variants = 0
    for make in sorted(tree, key=lambda m: strip_acc(m).lower()):
        models = []
        for model, years in tree[make].items():
            yl = []
            for y in sorted(years, reverse=True):
                vs = years[y]
                tot = sum(v['r'] for v in vs)
                # Gürültü: çok az tescilli ayrıntılar elenir; her yıl en çok 14 motor seçeneği
                vs = [v for v in vs if v['r'] >= max(8, tot * 0.004) or (make in TR_PRIORITY and v['r'] >= 1)]
                # Güç bilgisi eksik kayıtlar, aynı motorun güç bilgili kaydı varsa atılır (bazı ülkelerin eksik/varsayılan girdileri)
                known = {(v['f'], v['p'], v.get('cc')) for v in vs if v.get('kw')}
                vs = [v for v in vs if v.get('kw') or (v['f'], v['p'], v.get('cc')) not in known]
                vs.sort(key=lambda v: (-v['r']))
                vs = vs[:14]
                if not vs: continue
                vs.sort(key=lambda v: ({'benzin': 0, 'dizel': 1, 'lpg': 2, 'elektrik': 3}[v['f']], {'ice': 0, 'mhev': 1, 'hev': 2, 'phev': 3, 'bev': 4}[v['p']], v.get('cc') or 0, v.get('kw') or 0))
                for v in vs: v['r'] = round(v['r'] / tot, 3)
                yl.append({'y': y, 'v': vs}); total_variants += len(vs)
            if not yl: continue
            models.append({'n': display_model(model, make), 'k': model, 'body': body_of(model), 'reg': model_regs[(make, model)], 'years': yl})
        if not models: continue
        models.sort(key=lambda m: strip_acc(m['n']).lower())
        # Türkiye'ye özel eşdeğer: Renault Taliant = Dacia Logan III (aynı CMF-B taban, aynı 1.0 SCe/TCe/ECO-G motorlar)
        data = {'make': make, 'models': models}
        fn = slug(make) + '.json'
        json.dump(data, open(os.path.join(OUT, fn), 'w'), ensure_ascii=False, separators=(',', ':'))
        logo = LOGOS.get(make)
        index.append({'n': make, 'f': fn, 'models': len(models), 'reg': make_regs[make], **({'logo': logo} if logo else {})})
    # Taliant eşlemesi: Logan'ın 2021+ yıllarından
    try:
        dac = json.load(open(os.path.join(OUT, 'dacia.json')))
        ren = json.load(open(os.path.join(OUT, 'renault.json')))
        logan = next(m for m in dac['models'] if m['k'] == 'LOGAN')
        yrs = [y for y in logan['years'] if y['y'] >= 2021]
        if yrs:
            ren['models'].append({'n': 'Taliant', 'k': 'TALIANT', 'body': 'car', 'reg': 0, 'eq': 'Dacia Logan (aynı taban ve motorlar)', 'years': yrs})
            ren['models'].sort(key=lambda m: strip_acc(m['n']).lower())
            json.dump(ren, open(os.path.join(OUT, 'renault.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
            next(i for i in index if i['n'] == 'Renault')['models'] += 1
    except (StopIteration, FileNotFoundError):
        pass
    meta = {'source': 'EEA — CO2 emissions from new passenger cars (Regulation (EU) 2019/631), 2010–2025', 'built': __import__('datetime').date.today().isoformat(),
            'years': [2010, 2025], 'makes': index}
    json.dump(meta, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'markalar {len(index)} · motor seçeneği {total_variants} · boyut {size/1e6:.1f} MB')

if __name__ == '__main__':
    main()
