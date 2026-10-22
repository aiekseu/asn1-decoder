// Отрисовка модели в DOM.
'use strict';

/* ======================= Отрисовка ======================= */
const ICONS = {
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="m10.5 12.5 9-9M16 7l3 3M14 9l2 2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
function copyBtn(text) {
  return h('button', { class: 'copy', type: 'button', title: 'Скопировать', 'aria-label': 'Скопировать значение', onclick: e => { e.stopPropagation(); copy(text); } }, icon('copy'));
}
function oidEl(oid) { return oid ? h('span', { class: 'oid' }, oid) : null; }
function lookupLink(oid) {
  const text = registryHint(oid) ? ' найти описание' : ' неизвестный OID — найти';
  return h('a', { href: 'https://oidref.com/' + oid, target: '_blank', rel: 'noopener noreferrer', class: 'unknown', title: 'Посмотреть описание OID на oidref.com' }, text);
}

function renderValue(v) {
  if (v.text != null) {
    const t = v.href ? h('a', { href: v.href, target: '_blank', rel: 'noopener noreferrer' }, v.text) : v.text;
    return h('div', { class: v.mono ? 'mono' : null }, t);
  }
  if (v.chips) return h('div', { class: 'chips' }, v.chips.map(c => h('span', { class: 'chip' }, c.text, c.sub ? h('span', { class: 'oid' }, c.sub) : null)));
  if (v.items) return h('ul', { class: 'items' }, v.items.map(it => h('li', null,
    h('div', { class: it.mono ? 'mono' : null }, it.href ? h('a', { href: it.href, target: '_blank', rel: 'noopener noreferrer' }, it.text) : it.text,
      it.unknown ? lookupLink(it.text) : null),
    it.sub ? h('div', { class: 'note muted' }, it.sub) : null,
    it.oid ? oidEl(it.oid) : null,
    (it.extra || []).map(x => h('div', { class: 'note muted' }, x.label + ': ', x.href ? h('a', { href: x.href, target: '_blank', rel: 'noopener noreferrer' }, x.text) : x.text)),
  )));
  if (v.tree) return renderTree(v.tree);
  return h('div', null, '—');
}
function renderTree(nodes) {
  return h('ul', { class: 'tree' }, nodes.map(n => h('li', null,
    h('span', { class: 't' }, n.label), n.value != null ? h('span', { class: 'tv' }, n.value) : null,
    n.children && n.children.length ? renderTree(n.children) : null)));
}
function itemSearch(it) { return [it.text, it.sub, it.oid, ...(it.extra || []).map(x => x.text)].filter(Boolean).join(' '); }
function rowSearch(r) {
  const v = r.value;
  let s = r.label + ' ' + (r.oid || '') + ' ' + (r.oid ? oidShort(r.oid) : '') + ' ' + valueText(v);
  if (v.items) s += ' ' + v.items.map(itemSearch).join(' ');
  if (v.chips) s += ' ' + v.chips.map(c => c.sub || '').join(' ');
  if (r.note) s += ' ' + r.note.text;
  return s.toLowerCase();
}
function renderRow(r) {
  const copyText = r.copy != null ? r.copy : valueText(r.value);
  return h('div', { class: 'row', 'data-s': rowSearch(r), title: r.title || null },
    h('div', { class: 'k' }, r.label, r.oid ? h('span', { class: 'oid' }, r.oid + (oidShort(r.oid) ? ' · ' + oidShort(r.oid) : '')) : null),
    h('div', { class: 'v' }, renderValue(r.value), r.note ? h('div', { class: 'note ' + r.note.kind }, r.note.text) : null),
    copyText ? copyBtn(copyText) : h('span'));
}
function renderBlock(b) {
  return h('div', { class: 'block', 'data-s': (b.title + ' ' + b.oid + ' ' + oidShort(b.oid) + ' ' + (b.hint || '')).toLowerCase() },
    h('div', { class: 'block-head' },
      h('b', null, b.title),
      b.critical ? h('span', { class: 'badge warn', title: 'Критическое расширение: программа, которая его не понимает, обязана отклонить сертификат' }, 'критическое') : null,
      b.unknown ? lookupLink(b.oid) : null,
      h('span', { class: 'oid' }, b.oid + (oidShort(b.oid) ? ' · ' + oidShort(b.oid) : ''))),
    b.hint ? h('div', { class: 'block-hint note muted' }, b.hint) : null,
    b.rows.map(renderRow));
}
function renderSection(s) {
  const count = s.rows ? s.rows.length : s.blocks.length;
  const sec = h('section', { class: 'card section', id: 'sec-' + s.id, 'data-s': s.title.toLowerCase() });
  const head = h('button', { class: 'sec-head', type: 'button', 'aria-expanded': 'true', onclick: () => {
    sec.classList.toggle('closed');
    head.setAttribute('aria-expanded', String(!sec.classList.contains('closed')));
    updateToggleAll();
  } }, h('span', { class: 'ico' }, icon(s.icon)), s.title, h('span', { class: 'n' }, String(count)), h('span', { class: 'chev' }, icon('chev')));
  sec.append(head, h('div', { class: 'sec-body' }, s.rows ? s.rows.map(renderRow) : s.blocks.map(renderBlock)));
  return sec;
}

function fact(label, value, opts = {}) {
  if (!value) return null;
  return h('div', { class: 'fact', 'data-s': (label + ' ' + value).toLowerCase() },
    h('dt', null, label),
    h('dd', null, h('span', { class: opts.mono ? 'mono' : null, title: opts.title || null }, value), opts.copy !== false ? copyBtn(opts.copyText || value) : null));
}

function renderSummary(m) {
  const s = m.subject;
  const cn = nameGet(s, '2.5.4.3');
  const org = nameGet(s, '2.5.4.10');
  const sn = nameGet(s, '2.5.4.4'), gn = nameGet(s, '2.5.4.42');
  const fio = sn && gn ? `${sn} ${gn}` : null;
  const title = cn || org || fio || 'Без имени';
  const subParts = [];
  if (fio && fio !== title) subParts.push(fio);
  const pos = nameGet(s, '2.5.4.12');
  if (pos) subParts.push(pos);
  if (org && org !== title) subParts.push(org);

  const badges = [];
  if (m.kind === 'csr') badges.push(h('span', { class: 'badge accent' }, 'Запрос на сертификат'));
  else badges.push(h('span', { class: 'badge accent' }, m.isCA ? 'Сертификат УЦ' : 'Сертификат'));
  const ot = ownerType(s);
  if (ot) badges.push(h('span', { class: 'badge' }, ot));
  if (m.kind === 'cert' && m.selfSigned) badges.push(h('span', { class: 'badge' }, 'Самоподписанный'));
  if (m.kind === 'cert' && m.hasQualified) badges.push(h('span', { class: 'badge', title: 'Есть сведения о сертифицированных средствах ЭП и УЦ (63-ФЗ)' }, 'Признаки КЭП'));

  let validity = null;
  if (m.kind === 'cert') {
    const now = Date.now(), nb = +m.notBefore, na = +m.notAfter;
    let cls, text, extra;
    if (now < nb) { cls = 'warn'; text = 'Ещё не действует'; extra = `начнёт действовать через ${days(Math.ceil((nb - now) / 864e5))}`; }
    else if (now > na) { cls = 'bad'; text = 'Истёк'; extra = `${days(Math.floor((now - na) / 864e5))} назад`; }
    else {
      const left = Math.floor((na - now) / 864e5);
      cls = left < 30 ? 'warn' : 'ok'; text = left < 30 ? 'Скоро истекает' : 'Действует'; extra = `осталось ${days(left)}`;
    }
    badges.unshift(h('span', { class: 'badge ' + cls }, h('span', { class: 'dot' }), text));
    const pct = Math.min(100, Math.max(0, (now - nb) / (na - nb) * 100));
    validity = h('div', { class: 'validity' },
      h('div', { class: 'line' },
        h('span', null, 'с ', h('b', null, fmtDateShort(m.notBefore)), ' по ', h('b', null, fmtDateShort(m.notAfter))),
        h('span', null, extra)),
      h('div', { class: 'bar ' + cls, title: `Прошло ${Math.round(pct)}% срока` }, h('i', { style: `width:${now > na ? 100 : pct}%` })));
  }

  const inn = nameGet(s, '1.2.643.3.131.1.1');
  const snils = nameGet(s, '1.2.643.100.3');
  const eku = m.exts.find(e => e.oid === '2.5.29.37');
  const sst = m.exts.find(e => e.oid === '1.2.643.100.111');
  const facts = [
    fact('ИНН', inn),
    fact('ИНН юрлица', nameGet(s, '1.2.643.100.4')),
    fact('ОГРН', nameGet(s, '1.2.643.100.1')),
    fact('ОГРНИП', nameGet(s, '1.2.643.100.5')),
    fact('СНИЛС', snils && digits(snils) ? fmtSnils(snils) : snils, { copyText: snils }),
    fact('Эл. почта', nameGet(s, '1.2.840.113549.1.9.1')),
    m.kind === 'cert' ? fact('Издатель', dnShort(m.issuer)) : null,
    m.kind === 'cert' && m.pkup && m.pkup.to ? fact('Закрытый ключ действует до', fmtDateShort(m.pkup.to), { copy: false }) : null,
    fact('Ключ', m.spki.short, { copy: false }),
    sst && sst.node ? fact('Средство ЭП', anyText(sst.node)) : null,
    m.kind === 'csr' ? fact('Криптопровайдер', m.csp) : null,
    eku && eku.node ? (() => {
      const names = [...new Set(kids(eku.node).map(c => oidName(oidOf(c)) || oidOf(c)))];
      const text = names.slice(0, 3).join('; ') + (names.length > 3 ? ` и ещё ${names.length - 3}` : '');
      return fact('Назначения', text, { copy: false, title: names.join('\n') });
    })() : null,
    m.kind === 'cert' ? fact('Серийный номер', m.serialHex, { mono: true }) : null,
    m.kind === 'cert' ? fact('Отпечаток SHA-1', m.sha1Thumb, { mono: true }) : fact('Идентификатор ключа', m.spki.keyId, { mono: true }),
  ].filter(Boolean);

  const el = $('#summary');
  el.replaceChildren(...[
    h('div', { class: 'badges' }, badges),
    h('h2', null, title),
    subParts.length ? h('div', { class: 'sub' }, subParts.join(' · ')) : null,
    validity,
    h('dl', { class: 'facts' }, facts),
  ].filter(Boolean));
}
