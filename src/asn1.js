// Разбор ASN.1 DER/BER и декодирование примитивов (строки, OID, числа, даты).
'use strict';

/* ======================= Разбор ASN.1 DER/BER ======================= */
const T = { BOOL: 1, INT: 2, BIT: 3, OCT: 4, NULL: 5, OID: 6, ENUM: 10, UTF8: 12, SEQ: 16, SET: 17, NUM: 18, PRN: 19, T61: 20, VTX: 21, IA5: 22, UTC: 23, GEN: 24, GRAPH: 25, VIS: 26, GSTR: 27, UNI: 28, BMP: 30 };
const STRING_TAGS = new Set([T.UTF8, T.NUM, T.PRN, T.T61, T.VTX, T.IA5, T.GRAPH, T.VIS, T.GSTR, T.UNI, T.BMP]);

class ParseError extends Error {}

function readNode(buf, pos, limit, depth = 0) {
  if (depth > 64) throw new ParseError('Слишком глубокая вложенность');
  if (pos >= limit) throw new ParseError('Неожиданный конец данных');
  const start = pos;
  const b0 = buf[pos++];
  const cls = b0 >> 6, cons = (b0 & 0x20) !== 0;
  let tag = b0 & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let b;
    do {
      if (pos >= limit) throw new ParseError('Неожиданный конец данных');
      b = buf[pos++];
      tag = tag * 128 + (b & 0x7f);
    } while (b & 0x80);
  }
  if (pos >= limit) throw new ParseError('Неожиданный конец данных');
  let len = buf[pos++];
  const node = { buf, s: start, cls, cons, tag, cs: 0, ce: 0, end: 0, children: null };
  if (len === 0x80) {
    if (!cons) throw new ParseError('Неопределённая длина у примитивного элемента');
    node.cs = pos;
    node.children = [];
    for (;;) {
      if (pos + 1 < limit && buf[pos] === 0 && buf[pos + 1] === 0) { node.ce = pos; node.end = pos + 2; break; }
      const c = readNode(buf, pos, limit, depth + 1);
      node.children.push(c);
      pos = c.end;
    }
    return node;
  }
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n > 6 || pos + n > limit) throw new ParseError('Некорректная длина');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos++];
  }
  node.cs = pos;
  node.ce = pos + len;
  node.end = node.ce;
  if (node.ce > limit) throw new ParseError('Длина элемента выходит за пределы данных');
  if (cons) {
    node.children = [];
    let p = node.cs;
    while (p < node.ce) {
      const c = readNode(buf, p, node.ce, depth + 1);
      node.children.push(c);
      p = c.end;
    }
  }
  return node;
}

function tryParse(bytes) {
  if (!bytes || !bytes.length) return null;
  try {
    const n = readNode(bytes, 0, bytes.length);
    return n.end === bytes.length ? n : null;
  } catch { return null; }
}

const val = n => n.buf.subarray(n.cs, n.ce);
const raw = n => n.buf.subarray(n.s, n.end);
const kids = n => (n && n.children) || [];
const isU = (n, t) => !!n && n.cls === 0 && n.tag === t;
const isCtx = (n, t) => !!n && n.cls === 2 && n.tag === t;

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const utf8Loose = new TextDecoder('utf-8');
const win1251 = (() => { try { return new TextDecoder('windows-1251'); } catch { return null; } })();
const latin1 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s; };

function decodeText(bytes, tag) {
  switch (tag) {
    case T.UTF8: return fixMojibake(utf8Loose.decode(bytes));
    case T.BMP: {
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return s;
    }
    case T.UNI: {
      let s = '';
      for (let i = 0; i + 3 < bytes.length; i += 4) s += String.fromCodePoint(((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0);
      return s;
    }
    case T.T61: case T.GSTR: case T.VTX: case T.GRAPH: {
      try { return utf8Fatal.decode(bytes); } catch { return win1251 ? win1251.decode(bytes) : latin1(bytes); }
    }
    default: {
      try { return utf8Fatal.decode(bytes); } catch { return latin1(bytes); }
    }
  }
}
const str = n => decodeText(val(n), n.tag);

// Строка, закодированная в UTF-8 дважды («Ð˜Ð²Ð°Ð½»), — частая ошибка генераторов запросов
function fixMojibake(s) {
  if (!/[Â-ô][\u0080-¿Œ-™]/.test(s)) return s;
  const cp1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0xff) out.push(c);
    else if (cp1252[c]) out.push(cp1252[c]);
    else return s;
  }
  try { return utf8Fatal.decode(new Uint8Array(out)); } catch { return s; }
}

function oidStr(bytes) {
  const parts = [];
  let v = 0n, first = true;
  for (const b of bytes) {
    v = (v << 7n) | BigInt(b & 0x7f);
    if (!(b & 0x80)) {
      if (first) {
        if (v < 40n) parts.push(0n, v); else if (v < 80n) parts.push(1n, v - 40n); else parts.push(2n, v - 80n);
        first = false;
      } else parts.push(v);
      v = 0n;
    }
  }
  return parts.join('.');
}
const oidOf = n => oidStr(val(n));

function intBig(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  if (bytes.length && (bytes[0] & 0x80)) v -= 1n << BigInt(bytes.length * 8);
  return v;
}
const intNum = n => Number(intBig(val(n)));

const hex = (bytes, sep = '') => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(sep);

function bitLength(bytes) {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  if (i === bytes.length) return 0;
  return (bytes.length - i - 1) * 8 + (32 - Math.clz32(bytes[i]));
}

function parseTimeStr(s, generalized) {
  const m = generalized
    ? s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)?(\d\d)?(?:[.,](\d+))?(Z|[+-]\d{4})?$/)
    : s.match(/^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?()(Z|[+-]\d{4})?$/);
  if (!m) return null;
  let y = +m[1];
  if (!generalized) y += y < 50 ? 2000 : 1900;
  const ms = m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0;
  let t = Date.UTC(y, +m[2] - 1, +m[3], +m[4], +(m[5] || 0), +(m[6] || 0), ms);
  if (m[8] && m[8] !== 'Z') {
    const sign = m[8][0] === '-' ? -1 : 1;
    t -= sign * (+m[8].slice(1, 3) * 60 + +m[8].slice(3, 5)) * 60000;
  }
  return new Date(t);
}
const parseTime = n => parseTimeStr(latin1(val(n)), n.tag === T.GEN);
