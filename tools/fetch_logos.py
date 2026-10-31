#!/usr/bin/env python3
"""Marka logoları: her markanın İngilizce Wikipedia maddesine bağlı Wikidata öğesindeki "logo görseli" (P154)
dosya adı alınır ve tools/brand_logos.json'a yazılır. Görseller uygulamada Wikimedia Commons'tan yüklenir.
Logo yerine fotoğraf dönen markalar (ör. tabela/araç fotoğrafı) elle None yapılır; uygulama o zaman harf rozeti gösterir.
Ticari markalar sahiplerine aittir; yalnızca markayı tanıtmak için gösterilir."""
import json, os, subprocess, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
TITLES = {'Abarth': 'Abarth', 'Alfa Romeo': 'Alfa Romeo', 'Audi': 'Audi', 'BMW': 'BMW', 'BYD': 'BYD Auto', 'Chery': 'Chery', 'Chevrolet': 'Chevrolet',
          'Citroën': 'Citroën', 'Cupra': 'Cupra (automobile)', 'Dacia': 'Automobile Dacia', 'Daihatsu': 'Daihatsu', 'DS': 'DS Automobiles', 'Fiat': 'Fiat',
          'Ford': 'Ford Motor Company', 'Honda': 'Honda', 'Hyundai': 'Hyundai Motor Company', 'Infiniti': 'Infiniti', 'Jaecoo': 'Jaecoo', 'Jaguar': 'Jaguar Cars',
          'Jeep': 'Jeep', 'KGM (SsangYong)': 'KG Mobility', 'Kia': 'Kia', 'Lada': 'Lada', 'Lancia': 'Lancia', 'Land Rover': 'Land Rover', 'Leapmotor': 'Leapmotor',
          'Lexus': 'Lexus', 'Maserati': 'Maserati', 'Mazda': 'Mazda', 'Mercedes-Benz': 'Mercedes-Benz', 'MG': 'MG Motor', 'MINI': 'Mini (marque)',
          'Mitsubishi': 'Mitsubishi Motors', 'Nissan': 'Nissan', 'Omoda': 'Omoda', 'Opel': 'Opel', 'Peugeot': 'Peugeot', 'Porsche': 'Porsche', 'Renault': 'Renault',
          'Saab': 'Saab Automobile', 'Seat': 'SEAT', 'Škoda': 'Škoda Auto', 'Skywell': 'Skywell', 'Smart': 'Smart (marque)', 'Subaru': 'Subaru', 'Suzuki': 'Suzuki',
          'Tesla': 'Tesla, Inc.', 'Togg': 'Togg', 'Toyota': 'Toyota', 'Volkswagen': 'Volkswagen', 'Volvo': 'Volvo Cars', 'XPeng': 'XPeng', 'Zeekr': 'Zeekr'}
NOT_LOGO = {'Abarth', 'Peugeot'}
vals = ' '.join('"%s"@en' % t for t in TITLES.values())
q = 'SELECT ?title ?logo WHERE { VALUES ?title { %s } ?a schema:about ?i; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. ?i wdt:P154 ?logo }' % vals
out = subprocess.run(['curl', '-sS', '-m', '90', '-A', 'ATLAS3D/2.0 (https://github.com/biraristo/ATLAS3D) build-script', '-H', 'Accept: application/sparql-results+json',
                      '--data-urlencode', 'query=' + q, 'https://query.wikidata.org/sparql'], capture_output=True).stdout
got = {}
for b in json.loads(out)['results']['bindings']:
    got.setdefault(b['title']['value'], urllib.parse.unquote(b['logo']['value'].split('/')[-1]))
res = {mk: (None if mk in NOT_LOGO else got.get(t)) for mk, t in TITLES.items()}
json.dump(res, open(os.path.join(HERE, 'brand_logos.json'), 'w'), ensure_ascii=False, indent=1, sort_keys=True)
print(sum(1 for v in res.values() if v), 'logo')
