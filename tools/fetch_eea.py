#!/usr/bin/env python3
"""EEA "CO2 emissions from new passenger cars" verisini yıl yıl, marka/model/motor düzeyinde özetleyip indirir.

Kaynak: https://discodata.eea.europa.eu (açık SQL servisi). Çıktı: tools/.cache/eea/<yıl>.json
Servis bir istekte en çok 10.000 satır döndürür ve büyük tablolarda ORDER BY'a izin vermez; sayfalamadaki
kayma/eksik satır riskine karşı sorgu, marka adının baş harflerine göre her biri tek sayfaya sığan parçalara bölünür.
"""
import json, os, subprocess, string

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache', 'eea')
SQL = open(os.path.join(HERE, 'agg.sql')).read()
LIMIT = 10000

def run(q):
    out = subprocess.run([os.path.join(HERE, 'eea.sh'), q, str(LIMIT), '1'], capture_output=True, text=True).stdout
    d = json.loads(out)
    if 'results' not in d: raise RuntimeError(d)
    return d['results']

def fetch(tbl, year_filter):
    base = SQL.replace('TBL', tbl)
    if year_filter: base = base.replace('WHERE R > 0', f'WHERE R > 0 AND Year = {year_filter}')
    rows = []
    def part(lo, hi):
        cond = f"Mk >= '{lo}'" + (f" AND Mk < '{hi}'" if hi else '')
        res = run(base.replace('WHERE R > 0', f'WHERE R > 0 AND {cond}'))
        if len(res) < LIMIT: rows.extend(res); return
        # tek sayfaya sığmadı: aralık ikinci harfe göre bölünür
        subs = [lo + c for c in string.ascii_uppercase]
        bounds = [lo] + subs[1:] + [hi]
        for a, b in zip(bounds, bounds[1:]): part(a, b)
    # Boş/sayısal marka adları ve A–Z aralıkları
    letters = list(string.ascii_uppercase)
    rows.extend(run(base.replace('WHERE R > 0', "WHERE R > 0 AND (Mk IS NULL OR Mk < 'A')")))
    for i, c in enumerate(letters):
        part(c, letters[i + 1] if i + 1 < len(letters) else None)
    return rows

def main():
    os.makedirs(CACHE, exist_ok=True)
    jobs = [(y, f'co2cars_{t}', None) for y, t in [(2021, '2021Fv24'), (2022, '2022Fv26'), (2023, '2023Fv28'), (2024, '2024Fv30'), (2025, '2025Pv31')]]
    jobs += [(y, 'co2cars', y) for y in range(2010, 2021)]
    for y, tbl, wy in jobs:
        fn = os.path.join(CACHE, f'{y}.json')
        if os.path.exists(fn): continue
        rows = fetch(tbl, wy)
        print(y, tbl, len(rows), flush=True)
        json.dump(rows, open(fn, 'w'))

if __name__ == '__main__':
    main()
