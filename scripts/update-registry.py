#!/usr/bin/env python3
"""Обновляет src/registry.js из реестра OID РФ (https://oid.iitrust.ru).

В реестре для каждой ветки 1.2.643.N.* указана организация-владелец.
Скрипт скачивает все разделы (1.2.643.1–1.2.643.9) и пересобирает словарь.

Запуск из корня репозитория:
    python3 scripts/update-registry.py
"""
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

BASE = 'https://oid.iitrust.ru/oid_search/{}/'
# id раздела на сайте → корень ветки
SECTIONS = {5: '1.2.643.1', 11: '1.2.643.2', 16: '1.2.643.3', 6: '1.2.643.4', 17: '1.2.643.5',
            19: '1.2.643.6', 18: '1.2.643.7', 21: '1.2.643.8', 22: '1.2.643.9'}
OUT = Path(__file__).resolve().parent.parent / 'src' / 'registry.js'

ITEM_RE = re.compile(r'<table class="catalog-item".*?</table>', re.S)
NAME_RE = re.compile(r'class="main_raw"><a[^>]*>(.*?)</a>', re.S)
OIDS_RE = re.compile(r'class="oid_raw">.*?<span>(.*?)</span>', re.S)
OID_RE = re.compile(r'\d+(\.\d+)+')


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8')


def parse(page):
    for m in ITEM_RE.finditer(page):
        item = m.group(0)
        name, oids = NAME_RE.search(item), OIDS_RE.search(item)
        if not name or not oids:
            continue
        name = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', name.group(1)))).strip()
        for oid in oids.group(1).split(','):
            oid = oid.strip()
            if name and OID_RE.fullmatch(oid):
                yield oid, name


def main():
    reg = {}
    for sid, root in SECTIONS.items():
        n = 0
        for oid, name in parse(fetch(BASE.format(sid))):
            names = reg.setdefault(oid, [])
            if name not in names:
                names.append(name)
            n += 1
        print(f'{root}: {n} записей', file=sys.stderr)
    if len(reg) < 500:
        sys.exit(f'Подозрительно мало записей ({len(reg)}) — структура сайта могла измениться, файл не перезаписан')

    data = {k: ' / '.join(v) for k, v in sorted(reg.items(), key=lambda kv: [int(x) for x in kv[0].split('.')])}
    OUT.write_text(
        '// Сгенерировано scripts/update-registry.py — не редактировать вручную.\n'
        "'use strict';\n\n"
        '// Реестр OID РФ (oid.iitrust.ru, разделы 1.2.643.1–1.2.643.9): ветка → организация-владелец.\n'
        '// Описаний отдельных OID в реестре нет — только кому принадлежит ветка.\n'
        'const REGISTRY = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n',
        encoding='utf-8')
    print(f'Записано {len(data)} OID в {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
