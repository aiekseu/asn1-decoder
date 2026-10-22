// Превращает разобранный ASN.1 в модель документа: секции, строки, подсказки.
'use strict';

/* ======================= Проверки реквизитов ======================= */
const digits = s => /^\d+$/.test(s);
function checkInn(s) {
  if (s.length === 12 && s.startsWith('00')) s = s.slice(2); // ИНН ЮЛ, дополненный нулями (старый формат)
  const d = [...s].map(Number);
  const sum = w => w.reduce((a, k, i) => a + k * d[i], 0) % 11 % 10;
  if (s.length === 10) return sum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  if (s.length === 12) return sum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && sum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  return null;
}
function checkOgrn(s) {
  if (s.length === 13) return Number(BigInt(s.slice(0, 12)) % 11n % 10n) === +s[12];
  if (s.length === 15) return Number(BigInt(s.slice(0, 14)) % 13n % 10n) === +s[14];
  return null;
}
function checkSnils(s) {
  if (s.length !== 11) return null;
  if (+s.slice(0, 9) <= 1001998) return true;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +s[i] * (9 - i);
  let c = sum < 100 ? sum : (sum === 100 || sum === 101) ? 0 : sum % 101;
  if (c === 100) c = 0;
  return c === +s.slice(9);
}
const fmtSnils = s => s.length === 11 ? `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6, 9)} ${s.slice(9)}` : s;

/* ======================= Форматирование ======================= */
function fmtDate(d, withTime = true) {
  if (!d || isNaN(d)) return '—';
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return d.toLocaleString('ru-RU', opts).replace(' г. в ', ' г., ').replace(' в ', ', ');
}
const fmtDateShort = d => d && !isNaN(d) ? d.toLocaleDateString('ru-RU') : '—';
const utcHint = d => d && !isNaN(d) ? 'UTC: ' + d.toISOString().replace('T', ' ').replace('.000Z', '') : '';
function plural(n, a, b, c) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c;
}
const days = n => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
function fmtSize(n) { return n < 1024 ? `${n} Б` : `${(n / 1024).toFixed(1).replace('.', ',')} КБ`; }
function looksText(s) { return s.length > 0 && !/[\u0000-\u0008\u000e-\u001f�]/.test(s); }

/* ======================= Модель для отображения ======================= */
// row: { label, oid, value: {text|chips|items|tree}, copy, note }
function row(label, value, extra = {}) {
  if (typeof value === 'string' || typeof value === 'number') value = { text: String(value) };
  return Object.assign({ label, value }, extra);
}
function oidItem(oid, extra = {}) {
  const name = oidName(oid);
  return Object.assign(name ? { text: name, oid } : { text: oid, mono: true, unknown: true, sub: registryHint(oid) }, extra);
}
function valueText(v) {
  if (!v) return '';
  if (v.text != null) return v.text;
  if (v.chips) return v.chips.map(c => c.text).join(', ');
  if (v.items) return v.items.map(i => i.text + (i.sub ? ` (${i.sub})` : '')).join('\n');
  if (v.tree) return treeText(v.tree, 0).trim();
  return '';
}
function treeText(nodes, lvl) {
  return nodes.map(n => '  '.repeat(lvl) + [n.label, n.value].filter(Boolean).join(': ') + '\n' + (n.children ? treeText(n.children, lvl + 1) : '')).join('');
}

/* ---------- Имена (DN) ---------- */
function parseName(n) {
  const out = [];
  for (const rdn of kids(n)) for (const atv of kids(rdn)) {
    const [o, v] = kids(atv);
    if (!o || !v) continue;
    out.push({ oid: oidOf(o), value: anyText(v) });
  }
  return out;
}
function anyText(v) {
  if (v.cls === 0 && STRING_TAGS.has(v.tag)) return str(v);
  if (isU(v, T.UTC) || isU(v, T.GEN)) return fmtDate(parseTime(v));
  if (isU(v, T.INT)) return intBig(val(v)).toString();
  if (isU(v, T.OID)) { const o = oidOf(v); return oidName(o) || o; }
  if (isU(v, T.BOOL)) return val(v)[0] ? 'Да' : 'Нет';
  if (!v.cons) { const s = decodeText(val(v), T.UTF8); if (looksText(s)) return s; }
  return hex(raw(v));
}
const nameGet = (attrs, oid) => { const a = attrs.find(x => x.oid === oid); return a ? a.value : null; };

function nameRows(attrs) {
  return attrs.map(a => {
    const r = row(oidName(a.oid) || 'Неизвестный атрибут', a.value, { oid: a.oid, copy: a.value });
    if (!oidName(a.oid) && registryHint(a.oid)) r.note = { kind: 'muted', text: registryHint(a.oid) };
    const v = a.value.trim();
    if (a.oid === '1.2.643.3.131.1.1' || a.oid === '1.2.643.100.4') {
      if (a.oid === '1.2.643.3.131.1.1' && v.length === 12 && v.startsWith('00')) r.hintText = 'ИНН юрлица, дополненный нулями до 12 цифр';
      r.note = checksumNote(digits(v) ? checkInn(v) : false);
    } else if (a.oid === '1.2.643.100.1' || a.oid === '1.2.643.100.5') {
      r.note = checksumNote(digits(v) ? checkOgrn(v) : false);
    } else if (a.oid === '1.2.643.100.3') {
      r.value = { text: digits(v) ? fmtSnils(v) : v };
      r.note = checksumNote(digits(v) ? checkSnils(v) : false);
    } else if (a.oid === '2.5.4.6' && v.toUpperCase() === 'RU') {
      r.value = { text: 'RU — Россия' };
    }
    if (r.hintText) r.note = Object.assign({}, r.note, { text: r.hintText + (r.note ? ' · ' + r.note.text : '') });
    return r;
  });
}
function checksumNote(ok) {
  if (ok === true) return { kind: 'ok', text: '✓ контрольная сумма верна' };
  if (ok === false) return { kind: 'warn', text: '⚠ контрольная сумма не сходится' };
  return null;
}
function dnShort(attrs) {
  return nameGet(attrs, '2.5.4.3') || nameGet(attrs, '2.5.4.10') || attrs.map(a => a.value).join(', ') || '—';
}

/* ---------- GeneralName ---------- */
function generalName(n) {
  if (n.cls !== 2) return { label: 'Значение', text: anyText(n) };
  const v = val(n);
  switch (n.tag) {
    case 0: {
      const [o, wrapped] = kids(n);
      const oid = o ? oidOf(o) : '';
      const inner = wrapped && kids(wrapped)[0];
      return { label: oidName(oid) || 'Другое имя', oid, text: inner ? anyText(inner) : '' };
    }
    case 1: return { label: 'Электронная почта', text: latin1(v) };
    case 2: return { label: 'DNS-имя', text: latin1(v) };
    case 4: {
      const attrs = parseName(kids(n)[0]);
      return { label: 'Имя в каталоге', text: attrs.map(a => `${oidShort(a.oid) || oidName(a.oid) || a.oid}=${a.value}`).join(', ') };
    }
    case 6: { const u = latin1(v); return { label: 'URI', text: u, href: /^https?:\/\//i.test(u) ? u : null }; }
    case 7: {
      let ip;
      if (v.length === 4) ip = Array.from(v).join('.');
      else if (v.length === 16) ip = hex(v).match(/.{4}/g).join(':');
      else if (v.length === 8) ip = Array.from(v.subarray(0, 4)).join('.') + ' / ' + Array.from(v.subarray(4)).join('.');
      else ip = hex(v);
      return { label: 'IP-адрес', text: ip };
    }
    case 8: { const o = oidStr(v); return { label: 'Зарегистрированный OID', text: oidName(o) || o }; }
    default: return { label: `Имя [${n.tag}]`, text: n.cons ? '' : anyText(n) };
  }
}
function generalNamesRows(nodes) {
  return nodes.map(gn => {
    const g = generalName(gn);
    return row(g.label, { text: g.text, href: g.href }, { oid: g.oid, copy: g.text });
  });
}
function generalNamesItems(nodes) {
  return nodes.map(gn => {
    const g = generalName(gn);
    return { text: g.text, href: g.href, sub: g.label === 'URI' ? null : g.label };
  });
}

/* ---------- Обобщённое дерево для неизвестных структур ---------- */
function describe(n, depth = 0) {
  if (depth > 12) return { label: '…' };
  if (n.cls === 0) {
    switch (n.tag) {
      case T.BOOL: return { label: 'Логическое', value: val(n)[0] ? 'Да' : 'Нет' };
      case T.INT: case T.ENUM: {
        const b = val(n);
        return { label: 'Число', value: b.length > 8 ? hex(b) : intBig(b).toString() };
      }
      case T.BIT: {
        const b = val(n).subarray(1);
        const inner = tryParse(b);
        if (inner) return { label: 'Вложенные данные', children: [describe(inner, depth + 1)] };
        return { label: 'Битовая строка', value: b.length > 48 ? `${b.length} байт` : hex(b) };
      }
      case T.OCT: {
        const b = val(n);
        const inner = tryParse(b);
        if (inner && inner.cls === 0 && (inner.cons || STRING_TAGS.has(inner.tag) || inner.tag === T.OID || inner.tag === T.INT))
          return { label: 'Вложенные данные', children: [describe(inner, depth + 1)] };
        const s = decodeText(b, T.UTF8);
        if (looksText(s) && /[\p{L}\p{N}]/u.test(s)) return { label: 'Текст', value: s };
        return { label: 'Двоичные данные', value: b.length > 48 ? `${b.length} байт` : hex(b) };
      }
      case T.NULL: return { label: 'Пусто' };
      case T.OID: { const o = oidOf(n); const nm = oidName(o); return { label: 'OID', value: nm ? `${nm} (${o})` : o }; }
      case T.UTC: case T.GEN: return { label: 'Дата', value: fmtDate(parseTime(n)) };
      case T.SEQ: return { label: 'Последовательность', children: kids(n).map(c => describe(c, depth + 1)) };
      case T.SET: return { label: 'Набор', children: kids(n).map(c => describe(c, depth + 1)) };
      default:
        if (STRING_TAGS.has(n.tag)) return { label: 'Строка', value: str(n) };
    }
  }
  const label = n.cls === 2 ? `[${n.tag}]` : `Тег ${n.tag}`;
  if (n.cons) return { label, children: kids(n).map(c => describe(c, depth + 1)) };
  const s = decodeText(val(n), T.UTF8);
  return { label, value: looksText(s) ? s : hex(val(n)) };
}
function genericRows(node, bytes) {
  if (!node) return [row('Значение', { text: bytes.length > 64 ? `${bytes.length} байт двоичных данных` : hex(bytes), mono: true })];
  if (node.cls === 0 && STRING_TAGS.has(node.tag)) return [row('Значение', str(node), { copy: str(node) })];
  if (isU(node, T.INT)) return [row('Значение', intBig(val(node)).toString())];
  if (isU(node, T.NULL)) return [row('Значение', 'Присутствует (без данных)')];
  return [row('Содержимое', { tree: [describe(node)] })];
}

/* ---------- Расширения ---------- */
function parseExtensions(seqNode) {
  return kids(seqNode).map(e => {
    const c = kids(e);
    const oid = oidOf(c[0]);
    let critical = false, octet = c[1];
    if (isU(c[1], T.BOOL)) { critical = val(c[1])[0] !== 0; octet = c[2]; }
    const bytes = octet ? val(octet) : new Uint8Array();
    return { oid, critical, bytes, node: tryParse(bytes) };
  });
}

function bitFlags(n) {
  const b = val(n), unused = b[0], out = [];
  const total = (b.length - 1) * 8 - unused;
  for (let i = 0; i < total; i++) if (b[1 + (i >> 3)] & (0x80 >> (i & 7))) out.push(i);
  return out;
}

function oidListItems(nodes) { return nodes.map(c => oidItem(oidOf(c))); }

const EXT = {
  '2.5.29.15': n => [row('Разрешено', { chips: bitFlags(n).map(i => ({ text: KEY_USAGE[i] ? KEY_USAGE[i][1] : `Бит ${i}`, sub: KEY_USAGE[i] && KEY_USAGE[i][0] })) })],
  '2.5.29.37': n => [row('Назначения', { items: oidListItems(kids(n)) })],
  '1.3.6.1.4.1.311.21.10': n => [row('Назначения', { items: kids(n).map(p => oidItem(oidOf(kids(p)[0]))) })],
  '2.5.29.19': n => {
    const c = kids(n);
    let ca = false, path = null;
    for (const x of c) { if (isU(x, T.BOOL)) ca = val(x)[0] !== 0; if (isU(x, T.INT)) path = intNum(x); }
    const rows = [row('Тип субъекта', ca ? 'Удостоверяющий центр (может выпускать сертификаты)' : 'Конечный пользователь (не УЦ)')];
    if (ca) rows.push(row('Длина цепочки ниже', path == null ? 'Без ограничений' : String(path)));
    return rows;
  },
  '2.5.29.14': n => { const v = hex(val(n)); return [row('Идентификатор', { text: v, mono: true }, { copy: v })]; },
  '2.5.29.35': n => {
    const rows = [];
    for (const x of kids(n)) {
      if (isCtx(x, 0)) { const v = hex(val(x)); rows.push(row('Идентификатор ключа', { text: v, mono: true }, { copy: v })); }
      else if (isCtx(x, 1)) rows.push(...generalNamesRows(kids(x)).map(r => (r.label = 'Издатель: ' + r.label, r)));
      else if (isCtx(x, 2)) { const v = hex(val(x)); rows.push(row('Серийный номер сертификата издателя', { text: v, mono: true }, { copy: v })); }
    }
    return rows;
  },
  '2.5.29.17': n => generalNamesRows(kids(n)),
  '2.5.29.18': n => generalNamesRows(kids(n)),
  '2.5.29.31': n => crlDP(n),
  '2.5.29.46': n => crlDP(n),
  '1.3.6.1.5.5.7.1.1': n => infoAccess(n),
  '1.3.6.1.5.5.7.1.11': n => infoAccess(n),
  '2.5.29.32': n => {
    const items = kids(n).map(pi => {
      const [o, quals] = kids(pi);
      const item = oidItem(oidOf(o));
      const subs = [];
      for (const q of kids(quals)) {
        const [qo, qv] = kids(q);
        const qid = oidOf(qo);
        if (qid === '1.3.6.1.5.5.7.2.1' && qv) subs.push({ text: str(qv), href: /^https?:/i.test(str(qv)) ? str(qv) : null, label: 'Регламент' });
        else if (qid === '1.3.6.1.5.5.7.2.2' && qv) {
          for (const part of kids(qv)) if (part.cls === 0 && STRING_TAGS.has(part.tag)) subs.push({ text: str(part), label: 'Уведомление' });
        }
      }
      item.extra = subs;
      return item;
    });
    return [row('Политики', { items })];
  },
  '2.5.29.16': n => {
    const rows = [];
    for (const x of kids(n)) {
      const d = parseTimeStr(latin1(val(x)), true);
      if (isCtx(x, 0)) rows.push(row('Действует с', fmtDate(d), { title: utcHint(d) }));
      if (isCtx(x, 1)) rows.push(row('Действует по', fmtDate(d), { title: utcHint(d) }));
    }
    return rows;
  },
  '1.2.643.100.111': n => [row('Средство ЭП', anyText(n), { copy: anyText(n) })],
  '1.2.643.100.112': n => {
    const labels = ['Средство ЭП издателя', 'Средство УЦ издателя', 'Заключение на средство ЭП', 'Заключение на средство УЦ'];
    return kids(n).map((c, i) => row(labels[i] || `Поле ${i + 1}`, anyText(c), { copy: anyText(c) }));
  },
  '1.2.643.100.114': n => {
    const k = intNum(n);
    return [row('Способ', IDENT_KIND[k] ? `${IDENT_KIND[k]}` : `Код ${k}`, { note: { kind: 'muted', text: `Код ${k}` } })];
  },
  '1.3.6.1.4.1.311.21.7': n => {
    const c = kids(n);
    const t = oidOf(c[0]);
    const rows = [oidName(t) ? row('Шаблон', oidName(t), { oid: t, copy: t }) : row('Шаблон (OID)', { text: t, mono: true }, { copy: t })];
    if (c[1]) rows.push(row('Версия', c[2] ? `${intNum(c[1])}.${intNum(c[2])}` : String(intNum(c[1]))));
    return rows;
  },
  '1.3.6.1.4.1.311.20.2': n => [row('Имя шаблона', anyText(n))],
  '1.3.6.1.4.1.311.21.1': n => { const v = intNum(n); return [row('Версия', `V${v & 0xffff}.${v >>> 16}`)]; },
  '1.3.6.1.4.1.311.21.2': n => { const v = hex(val(n)); return [row('Хеш', { text: v, mono: true }, { copy: v })]; },
  '1.2.840.113549.1.9.15': n => [row('Алгоритмы', { items: kids(n).map(c => oidItem(oidOf(kids(c)[0]))) })],
  '2.16.840.1.113730.1.1': n => [row('Типы', { chips: bitFlags(n).map(i => ({ text: NS_CERT_TYPE[i] || `Бит ${i}` })) })],
  '2.16.840.1.113730.1.13': n => [row('Комментарий', anyText(n))],
  '1.3.6.1.5.5.7.48.1.5': () => [row('Значение', 'Да — статус этого сертификата не проверяется через OCSP')],
  '2.5.29.9': n => kids(n).map(attr => {
    const [o, set] = kids(attr);
    const oid = oidOf(o);
    const vals = kids(set).map(v => {
      if (isU(v, T.GEN) || isU(v, T.UTC)) return fmtDate(parseTime(v), false);
      return anyText(v);
    }).join(', ');
    return row(oidName(oid) || oid, vals, { oid, copy: vals });
  }),
};

function crlDP(n) {
  const items = [];
  for (const dp of kids(n)) {
    for (const part of kids(dp)) {
      if (isCtx(part, 0)) {
        for (const nm of kids(part)) {
          if (isCtx(nm, 0)) items.push(...generalNamesItems(kids(nm)));
          else if (isCtx(nm, 1)) items.push({ text: 'Относительно издателя CRL', sub: 'Имя' });
        }
      } else if (isCtx(part, 1)) {
        const fake = { buf: part.buf, cs: part.cs, ce: part.ce };
        items.push({ text: bitFlags(fake).map(i => CRL_REASONS[i] || i).join(', '), sub: 'Причины отзыва' });
      } else if (isCtx(part, 2)) {
        items.push(...generalNamesItems(kids(part)).map(i => (i.sub = 'Издатель CRL', i)));
      }
    }
  }
  return [row('Адреса', { items })];
}
function infoAccess(n) {
  return kids(n).map(ad => {
    const [m, loc] = kids(ad);
    const oid = oidOf(m);
    const g = generalName(loc);
    return row(oidName(oid) || oid, { text: g.text, href: g.href }, { oid, copy: g.text });
  });
}

const EXT_ORDER = ['2.5.29.15', '2.5.29.37', '1.2.643.100.111', '1.2.643.100.112', '2.5.29.32', '2.5.29.16', '1.2.643.100.114', '2.5.29.17', '2.5.29.19', '2.5.29.31', '1.3.6.1.5.5.7.1.1', '2.5.29.14', '2.5.29.35'];
function extensionBlocks(exts) {
  const rank = o => { const i = EXT_ORDER.indexOf(o); return i < 0 ? 999 : i; };
  return [...exts].sort((a, b) => rank(a.oid) - rank(b.oid)).map(e => {
    let rows;
    try {
      rows = EXT[e.oid] && e.node ? EXT[e.oid](e.node) : genericRows(e.node, e.bytes);
    } catch {
      rows = genericRows(e.node, e.bytes);
    }
    return { title: oidName(e.oid) || 'Неизвестное расширение', oid: e.oid, critical: e.critical, unknown: !oidName(e.oid), hint: oidName(e.oid) ? null : registryHint(e.oid), rows };
  });
}

/* ---------- Атрибуты запроса ---------- */
function attributeBlocks(attrs) {
  const blocks = [];
  for (const a of attrs) {
    if (a.oid === '1.2.840.113549.1.9.14' || a.oid === '1.3.6.1.4.1.311.2.1.14') continue;
    const v = a.values[0];
    let rows;
    try {
      switch (a.oid) {
        case '1.3.6.1.4.1.311.13.2.3': rows = [row('Версия', anyText(v))]; break;
        case '1.3.6.1.4.1.311.21.20': {
          const c = kids(v);
          const labels = ['Идентификатор клиента', 'Компьютер', 'Пользователь', 'Программа'];
          rows = c.map((x, i) => row(labels[i] || `Поле ${i + 1}`, anyText(x), { copy: anyText(x) }));
          break;
        }
        case '1.3.6.1.4.1.311.13.2.2': {
          rows = [];
          for (const x of kids(v)) {
            if (isU(x, T.INT)) { const k = intNum(x); rows.push(row('Назначение ключа', k === 1 ? 'Обмен ключами и подпись (AT_KEYEXCHANGE)' : k === 2 ? 'Только подпись (AT_SIGNATURE)' : `Код ${k}`)); }
            else if (x.cls === 0 && STRING_TAGS.has(x.tag)) rows.push(row('Криптопровайдер', str(x), { copy: str(x) }));
          }
          break;
        }
        case '1.3.6.1.4.1.311.13.2.1':
          rows = a.values.map(p => { const [k, vv] = kids(p); return row(k ? anyText(k) : 'Параметр', vv ? anyText(vv) : ''); });
          break;
        default:
          rows = a.values.flatMap(x => genericRows(x, raw(x)));
      }
    } catch {
      rows = a.values.flatMap(x => genericRows(x, raw(x)));
    }
    blocks.push({ title: oidName(a.oid) || 'Неизвестный атрибут', oid: a.oid, unknown: !oidName(a.oid), hint: oidName(a.oid) ? null : registryHint(a.oid), rows });
  }
  return blocks;
}

/* ---------- Открытый ключ ---------- */
function parseSPKI(n) {
  const [algSeq, bitStr] = kids(n);
  const algOid = oidOf(kids(algSeq)[0]);
  const params = kids(algSeq)[1];
  const keyBytes = val(bitStr).subarray(1);
  const rows = [row('Алгоритм', oidName(algOid) || algOid, { oid: algOid })];
  let size = null, short = oidName(algOid) || algOid;

  if (algOid === '1.2.840.113549.1.1.1' || algOid === '1.2.840.113549.1.1.10') {
    const k = tryParse(keyBytes);
    if (k && kids(k).length >= 2) {
      size = bitLength(val(kids(k)[0]));
      rows.push(row('Размер ключа', `${size} бит`));
      rows.push(row('Открытая экспонента', intBig(val(kids(k)[1])).toString()));
    }
    short = `RSA ${size || ''}`.trim();
  } else if (algOid === '1.2.840.10045.2.1') {
    if (isU(params, T.OID)) {
      const c = oidOf(params);
      rows.push(row('Кривая', oidName(c) || c, { oid: c }));
      size = { '1.2.840.10045.3.1.7': 256, '1.3.132.0.34': 384, '1.3.132.0.35': 521, '1.3.132.0.10': 256 }[c] || null;
      if (size) rows.push(row('Размер ключа', `${size} бит`));
      short = `ECDSA ${oidShort(c) || ''}`.trim();
    }
  } else if (algOid.startsWith('1.2.643.')) {
    size = /\.2$/.test(algOid) && algOid.startsWith('1.2.643.7.1.1.') ? 512 : 256;
    if (algOid === '1.2.643.2.2.20') size = null;
    if (size) rows.push(row('Размер ключа', `${size} бит`));
    const p = kids(params);
    const labels = ['Параметры ключа', 'Параметры хеширования', 'Параметры шифрования'];
    p.forEach((x, i) => {
      if (isU(x, T.OID)) { const o = oidOf(x); rows.push(row(labels[i] || 'Параметр', oidName(o) || o, { oid: o })); }
    });
    short = oidName(algOid) || algOid;
  } else if (algOid === '1.3.101.112' || algOid === '1.3.101.110') {
    size = 256; rows.push(row('Размер ключа', '256 бит'));
  } else if (params && !isU(params, T.NULL)) {
    rows.push(row('Параметры', { tree: [describe(params)] }));
  }
  // RFC 5280 — SHA-1 от значения ключа; КриптоПро считает SHA-1 от BIT STRING целиком
  const keyIdRfc = sha1(keyBytes), keyIdTlv = sha1(raw(bitStr));
  const keyId = algOid.startsWith('1.2.643.') ? keyIdTlv : keyIdRfc;
  const keyRow = row('Идентификатор ключа (SHA-1)', { text: keyId, mono: true }, { copy: keyId, note: { kind: 'muted', text: 'Вычислен по открытому ключу' } });
  rows.push(keyRow);
  return { algOid, size, short, rows, keyId, keyIdRfc, keyIdTlv, keyRow };
}

/* ======================= Распознавание входных данных ======================= */
class UserError extends Error {}

function b64decode(s) {
  s = s.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function blobsFromText(text) {
  const re = /-----BEGIN ([A-Z0-9 #]+)-----([\s\S]*?)-----END \1-----/g;
  const blocks = [...text.matchAll(re)];
  if (blocks.length) {
    return blocks.map(m => {
      const body = m[2].split(/\r?\n/).filter(l => !l.includes(':')).join('');
      return b64decode(body);
    });
  }
  const t = text.trim();
  if (!t) return [];
  const hx = t.replace(/[\s:]/g, '');
  if (/^[0-9a-fA-F]+$/.test(hx) && hx.length % 2 === 0 && /^30/.test(hx)) {
    return [Uint8Array.from(hx.match(/../g), x => parseInt(x, 16))];
  }
  const b = t.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/_-]+=*$/.test(b)) {
    let bytes = null;
    try { bytes = b64decode(b); } catch { /* упадём ниже */ }
    if (bytes && bytes[0] === 0x30) return [bytes];
  }
  throw new UserError('Не удалось распознать формат');
}

// Возвращает список объектов { kind: 'cert'|'csr', node, der }
function classify(bytes) {
  let root;
  try { root = readNode(bytes, 0, bytes.length); }
  catch (e) { throw new UserError('Данные повреждены или это не ASN.1: ' + e.message); }
  if (!isU(root, T.SEQ)) throw new UserError('Ожидалась ASN.1-структура SEQUENCE');
  const c = kids(root);

  if (isU(c[0], T.OID) && oidOf(c[0]) === '1.2.840.113549.1.7.2') {
    const sd = kids(c[1])[0];
    const certSet = kids(sd).find(x => isCtx(x, 0));
    const certs = kids(certSet).filter(x => isU(x, T.SEQ));
    if (!certs.length) throw new UserError('В контейнере PKCS#7 нет сертификатов');
    return certs.map(n => ({ kind: 'cert', node: n, der: raw(n) }));
  }
  if (c.length >= 3 && isU(c[0], T.SEQ) && isU(c[1], T.SEQ) && isU(c[2], T.BIT)) {
    const tbs = kids(c[0]);
    if (isCtx(tbs[0], 0) || (tbs.length >= 6 && isU(tbs[0], T.INT))) return [{ kind: 'cert', node: root, der: raw(root) }];
    if (isU(tbs[0], T.INT) && isU(tbs[1], T.SEQ) && isU(tbs[2], T.SEQ) && (tbs.length === 3 || isCtx(tbs[3], 0)))
      return [{ kind: 'csr', node: root, der: raw(root) }];
    if (tbs.some(x => isU(x, T.UTC) || isU(x, T.GEN))) throw new UserError('Похоже, это список отзыва (CRL) — он пока не поддерживается');
  }
  throw new UserError('Структура не похожа ни на сертификат, ни на запрос на сертификат');
}

/* ======================= Сборка модели документа ======================= */
function buildCert(item) {
  const [tbs, sigAlg] = kids(item.node);
  const t = kids(tbs);
  let i = 0, version = 1;
  if (isCtx(t[0], 0)) { version = intNum(kids(t[0])[0]) + 1; i = 1; }
  const serialNode = t[i++]; i++;
  const issuer = parseName(t[i++]);
  const validity = kids(t[i++]);
  const subject = parseName(t[i++]);
  const spki = parseSPKI(t[i++]);
  let exts = [];
  for (; i < t.length; i++) if (isCtx(t[i], 3)) exts = parseExtensions(kids(t[i])[0]);

  const notBefore = parseTime(validity[0]), notAfter = parseTime(validity[1]);
  const sigOid = oidOf(kids(sigAlg)[0]);
  const serialBytes = val(serialNode);
  const serialHex = hex(serialBytes.length > 1 && serialBytes[0] === 0 ? serialBytes.subarray(1) : serialBytes);
  const ext = oid => exts.find(e => e.oid === oid);

  // признаки
  let isCA = false;
  const bc = ext('2.5.29.19');
  if (bc && bc.node) for (const x of kids(bc.node)) if (isU(x, T.BOOL)) isCA = val(x)[0] !== 0;
  const selfSigned = raw(t[version === 1 ? 2 : 3]).join() === raw(t[version === 1 ? 4 : 5]).join();
  let pkup = null;
  const pk = ext('2.5.29.16');
  if (pk && pk.node) {
    pkup = {};
    for (const x of kids(pk.node)) {
      const d = parseTimeStr(latin1(val(x)), true);
      if (isCtx(x, 0)) pkup.from = d;
      if (isCtx(x, 1)) pkup.to = d;
    }
  }

  checkKeyId(spki, exts);
  const sha1Thumb = sha1(item.der), sha256Thumb = sha256(item.der);
  const sections = [
    { id: 'general', title: 'Общие сведения', icon: 'doc', rows: [
      row('Тип', isCA ? 'Сертификат удостоверяющего центра' : 'Сертификат'),
      row('Версия', `X.509 v${version}`),
      row('Серийный номер', { text: serialHex, mono: true }, { copy: serialHex, note: { kind: 'muted', text: 'в десятичном виде: ' + intBig(serialBytes).toString() } }),
      row('Алгоритм подписи', oidName(sigOid) || sigOid, { oid: sigOid }),
      row('Отпечаток SHA-1', { text: sha1Thumb, mono: true }, { copy: sha1Thumb, note: { kind: 'muted', text: 'используется в Windows и КриптоПро для поиска сертификата' } }),
      row('Отпечаток SHA-256', { text: sha256Thumb, mono: true }, { copy: sha256Thumb }),
    ] },
    { id: 'subject', title: 'Владелец сертификата', icon: 'user', rows: nameRows(subject) },
    { id: 'issuer', title: 'Издатель (удостоверяющий центр)', icon: 'building', rows: nameRows(issuer) },
    { id: 'validity', title: 'Срок действия', icon: 'calendar', rows: [
      row('Действует с', fmtDate(notBefore), { title: utcHint(notBefore), copy: fmtDate(notBefore) }),
      row('Действует по', fmtDate(notAfter), { title: utcHint(notAfter), copy: fmtDate(notAfter) }),
      ...(pkup && pkup.from ? [row('Закрытый ключ действует с', fmtDate(pkup.from), { title: utcHint(pkup.from) })] : []),
      ...(pkup && pkup.to ? [row('Закрытый ключ действует по', fmtDate(pkup.to), { title: utcHint(pkup.to) })] : []),
      row('Длительность', days(Math.round((notAfter - notBefore) / 864e5))),
    ] },
    { id: 'key', title: 'Открытый ключ', icon: 'key', rows: spki.rows },
  ];
  if (exts.length) sections.push({ id: 'ext', title: 'Расширения', icon: 'list', blocks: extensionBlocks(exts) });

  return {
    kind: 'cert', subject, issuer, spki, exts, isCA, selfSigned, notBefore, notAfter, pkup, sha1Thumb, serialHex, sections,
    hasQualified: !!ext('1.2.643.100.112') && !!ext('1.2.643.100.111'),
  };
}

function buildCsr(item) {
  const [cri, sigAlg] = kids(item.node);
  const c = kids(cri);
  const version = intNum(c[0]) + 1;
  const subject = parseName(c[1]);
  const spki = parseSPKI(c[2]);
  const attrs = c[3] ? kids(c[3]).map(a => { const [o, set] = kids(a); return { oid: oidOf(o), values: kids(set) }; }) : [];
  let exts = [];
  for (const a of attrs) if ((a.oid === '1.2.840.113549.1.9.14' || a.oid === '1.3.6.1.4.1.311.2.1.14') && a.values[0]) exts = exts.concat(parseExtensions(a.values[0]));
  const sigOid = oidOf(kids(sigAlg)[0]);
  checkKeyId(spki, exts);

  const sections = [
    { id: 'general', title: 'Общие сведения', icon: 'doc', rows: [
      row('Тип', 'Запрос на сертификат (PKCS#10)'),
      row('Версия', String(version)),
      row('Алгоритм подписи', oidName(sigOid) || sigOid, { oid: sigOid }),
    ] },
    { id: 'subject', title: 'Владелец (данные в запросе)', icon: 'user', rows: subject.length ? nameRows(subject) : [row('Имя', 'Не указано')] },
    { id: 'key', title: 'Открытый ключ', icon: 'key', rows: spki.rows },
  ];
  if (exts.length) sections.push({ id: 'ext', title: 'Запрашиваемые расширения', icon: 'list', blocks: extensionBlocks(exts) });
  const ab = attributeBlocks(attrs);
  if (ab.length) sections.push({ id: 'attrs', title: 'Атрибуты запроса', icon: 'tag', blocks: ab });

  const cspAttr = attrs.find(a => a.oid === '1.3.6.1.4.1.311.13.2.2');
  let csp = null;
  if (cspAttr && cspAttr.values[0]) for (const x of kids(cspAttr.values[0])) if (x.cls === 0 && STRING_TAGS.has(x.tag)) csp = str(x);
  return { kind: 'csr', subject, spki, exts, sections, csp };
}

// Сверяет вычисленный идентификатор ключа с расширением «Идентификатор ключа субъекта»
function checkKeyId(spki, exts) {
  const ski = exts.find(e => e.oid === '2.5.29.14');
  if (!ski || !ski.node) return;
  const v = hex(val(ski.node));
  if (v === spki.keyIdRfc || v === spki.keyIdTlv) {
    spki.keyId = v;
    spki.keyRow.value.text = v; spki.keyRow.copy = v;
    spki.keyRow.note = { kind: 'ok', text: '✓ совпадает с «Идентификатором ключа субъекта» в расширениях' };
  } else {
    spki.keyRow.note = { kind: 'muted', text: 'Не совпадает с «Идентификатором ключа субъекта» — издатель вычислил его своим способом' };
  }
}

function ownerType(subject) {
  const has = o => !!nameGet(subject, o);
  if (has('1.2.643.100.5')) return 'Индивидуальный предприниматель';
  if (has('1.2.643.100.4') || has('1.2.643.100.1')) return 'Юридическое лицо';
  const inn = nameGet(subject, '1.2.643.3.131.1.1');
  if (inn && inn.length === 12 && inn.startsWith('00')) return 'Юридическое лицо';
  if (has('1.2.643.100.3') || inn) return 'Физическое лицо';
  return null;
}
