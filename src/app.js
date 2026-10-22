// Состояние страницы, поиск, копирование и обработчики событий.
'use strict';

// Версия релиза — меняется при каждом выпуске (см. CHANGELOG.md)
const APP_VERSION = '1.0.0';

/* ======================= Состояние и взаимодействие ======================= */
const $ = s => document.querySelector(s);
const state = { items: [], models: [], current: 0, source: '' };

function showError(title, detail) {
  const el = $('#error');
  el.replaceChildren(icon('alert'), h('div', null, h('b', null, title), detail ? h('span', null, detail) : null));
  el.hidden = false;
}
function clearError() { $('#error').hidden = true; }

function decodeBytesList(list, sourceLabel) {
  clearError();
  const items = [];
  for (const bytes of list) items.push(...classify(bytes));
  if (!items.length) throw new UserError('Не найдено данных для расшифровки');
  const models = items.map(it => it.kind === 'cert' ? buildCert(it) : buildCsr(it));
  state.items = items; state.models = models; state.current = 0; state.source = sourceLabel || '';
  renderPicker();
  show(0);
  $('#inputCard').classList.add('compact');
  $('#clear').hidden = false;
}

function handleText(text, label) {
  try {
    const list = blobsFromText(text);
    if (!list.length) { reset(); return; }
    decodeBytesList(list, label);
  } catch (e) {
    fail(e);
  }
}
function handleBytes(bytes, label) {
  try {
    if (bytes[0] === 0x30) {
      // бинарный DER; хвостовой мусор (переводы строк, нули) отбрасываем
      const n = readNode(bytes, 0, bytes.length);
      decodeBytesList([bytes.subarray(0, n.end)], label);
      return;
    }
    let text;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
    else text = utf8Loose.decode(bytes);
    $('#src').value = text;
    handleText(text, label);
  } catch (e) {
    fail(e);
  }
}
function fail(e) {
  $('#result').hidden = true; $('#picker').hidden = true;
  $('#inputCard').classList.remove('compact');
  if (e instanceof UserError || e instanceof ParseError) {
    showError(e.message, 'Поддерживаются сертификаты (.cer, .crt, .der, .pem), запросы на сертификат (.csr, .req, .p10) и контейнеры PKCS#7 (.p7b) — в виде файла, PEM или Base64.');
  } else {
    console.error(e);
    showError('Не удалось разобрать данные', 'Возможно, структура повреждена или использует неподдерживаемый формат. Подробности — в консоли браузера.');
  }
}
function reset() {
  state.items = []; state.models = [];
  $('#result').hidden = true; $('#picker').hidden = true;
  $('#inputCard').classList.remove('compact');
  $('#fileLabel').textContent = '';
  $('#clear').hidden = true;
  clearError();
}

function renderPicker() {
  const p = $('#picker');
  if (state.models.length < 2) { p.hidden = true; return; }
  p.hidden = false;
  p.replaceChildren(h('span', { class: 'lbl' }, `Найдено ${state.models.length} ${plural(state.models.length, 'объект', 'объекта', 'объектов')}:`),
    ...state.models.map((m, i) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(i === state.current), onclick: () => show(i) },
      h('span', null, dnShort(m.subject)), h('small', null, m.kind === 'csr' ? 'запрос' : m.isCA ? 'УЦ' : 'сертификат'))));
}

function show(i) {
  state.current = i;
  const m = state.models[i];
  [...$('#picker').querySelectorAll('.pick')].forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  renderSummary(m);
  $('#sections').replaceChildren(...m.sections.map(renderSection), h('div', { class: 'nores hidden', id: 'nores' }, 'Ничего не найдено. Попробуйте другой запрос.'));
  $('#result').hidden = false;
  applySearch();
  updateToggleAll();
}

/* ---------- Поиск ---------- */
function unmark(root) {
  root.querySelectorAll('mark').forEach(m => { const p = m.parentNode; m.replaceWith(m.textContent); p.normalize(); });
}
function markText(root, q) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement.closest('.oid, button, svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const tn of nodes) {
    const txt = tn.nodeValue, low = txt.toLowerCase();
    let idx = low.indexOf(q);
    if (idx < 0) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (idx >= 0) {
      frag.append(txt.slice(last, idx), h('mark', null, txt.slice(idx, idx + q.length)));
      last = idx + q.length;
      idx = low.indexOf(q, last);
    }
    frag.append(txt.slice(last));
    tn.replaceWith(frag);
  }
}
function applySearch() {
  const q = $('#q').value.trim().toLowerCase();
  const root = $('#sections');
  unmark(root); unmark($('#summary'));
  let total = 0;
  for (const sec of root.querySelectorAll('.section')) {
    const secHit = q && sec.dataset.s.includes(q);
    let visible = 0;
    const units = sec.querySelectorAll(':scope > .sec-body > .row, :scope > .sec-body > .block');
    for (const u of units) {
      if (u.classList.contains('block')) {
        const blockHit = !q || secHit || u.dataset.s.includes(q);
        let vis = 0;
        for (const r of u.querySelectorAll('.row')) {
          const hit = !q || blockHit || r.dataset.s.includes(q);
          r.classList.toggle('hidden', !hit);
          if (hit) { vis++; if (q && r.dataset.s.includes(q)) total++; }
        }
        if (q && blockHit && !secHit && u.dataset.s.includes(q)) total++;
        u.classList.toggle('hidden', vis === 0);
        if (vis) visible++;
      } else {
        const hit = !q || secHit || u.dataset.s.includes(q);
        u.classList.toggle('hidden', !hit);
        if (hit) { visible++; if (q && u.dataset.s.includes(q)) total++; }
      }
    }
    sec.classList.toggle('hidden', visible === 0);
    if (q && visible) sec.classList.remove('closed');
  }
  const nores = $('#nores');
  if (nores) nores.classList.toggle('hidden', !q || root.querySelectorAll('.section:not(.hidden)').length > 0);
  $('#count').textContent = q ? (total ? `${total} ${plural(total, 'совпадение', 'совпадения', 'совпадений')}` : 'нет') : '';
  if (q) { markText(root, q); markText($('#summary'), q); }
  updateToggleAll();
}

/* ---------- Копирование ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Скопировано');
}
function modelText(m) {
  const lines = [];
  const add = (lvl, label, v) => {
    const t = valueText(v).split('\n');
    lines.push('  '.repeat(lvl) + label + ': ' + t[0]);
    for (const x of t.slice(1)) lines.push('  '.repeat(lvl) + ' '.repeat(label.length + 2) + x);
  };
  for (const s of m.sections) {
    lines.push('', s.title.toUpperCase());
    if (s.rows) s.rows.forEach(r => add(1, r.label, r.value));
    else s.blocks.forEach(b => {
      lines.push('  ' + b.title + (b.critical ? ' (критическое)' : '') + ` [${b.oid}]`);
      b.rows.forEach(r => add(2, r.label, r.value));
    });
  }
  return lines.join('\n').trim() + '\n';
}

/* ---------- Свернуть / развернуть ---------- */
function updateToggleAll() {
  const secs = [...document.querySelectorAll('#sections .section:not(.hidden)')];
  const anyOpen = secs.some(s => !s.classList.contains('closed'));
  $('#toggleAll .txt').textContent = anyOpen ? 'Свернуть всё' : 'Развернуть всё';
  $('#toggleAll').dataset.mode = anyOpen ? 'close' : 'open';
}

/* ---------- События ---------- */
const src = $('#src');
let inputTimer;
src.addEventListener('input', () => {
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => { $('#fileLabel').textContent = ''; handleText(src.value, ''); }, 250);
});
src.addEventListener('paste', () => setTimeout(() => { clearTimeout(inputTimer); $('#fileLabel').textContent = ''; handleText(src.value, ''); }, 0));

document.addEventListener('paste', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const text = e.clipboardData && e.clipboardData.getData('text');
  if (!text) return;
  e.preventDefault();
  src.value = text;
  $('#fileLabel').textContent = '';
  handleText(text, '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#pickFile').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; });
function readFile(f) {
  if (f.size > 5 * 1024 * 1024) { fail(new UserError('Файл слишком большой (больше 5 МБ)')); return; }
  const r = new FileReader();
  r.onload = () => {
    const bytes = new Uint8Array(r.result);
    $('#fileLabel').replaceChildren(icon('doc'), `${f.name} · ${fmtSize(f.size)}`);
    if (bytes[0] === 0x30) src.value = '';
    handleBytes(bytes, f.name);
  };
  r.readAsArrayBuffer(f);
}

let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#overlay').classList.add('show'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#overlay').classList.remove('show'); } });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#overlay').classList.remove('show');
  const f = e.dataTransfer.files[0];
  if (f) readFile(f);
});

document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', () => {
  src.value = SAMPLES[b.dataset.sample];
  $('#fileLabel').textContent = '';
  handleText(src.value, '');
}));
$('#clear').addEventListener('click', () => { src.value = ''; $('#q').value = ''; reset(); src.focus(); });

$('#q').addEventListener('input', applySearch);
$('#q').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; applySearch(); e.target.blur(); } });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input, textarea') && !$('#result').hidden) { e.preventDefault(); $('#q').focus(); }
});

$('#toggleAll').addEventListener('click', () => {
  const close = $('#toggleAll').dataset.mode === 'close';
  document.querySelectorAll('#sections .section').forEach(s => {
    s.classList.toggle('closed', close);
    s.querySelector('.sec-head').setAttribute('aria-expanded', String(!close));
  });
  updateToggleAll();
});
$('#copyAll').addEventListener('click', () => { const m = state.models[state.current]; if (m) copy(modelText(m)); });

// Тема: авто (как в системе) → светлая → тёмная
const THEMES = { auto: ['auto', 'Авто', 'Тема как в системе'], light: ['sun', 'Светлая', 'Светлая тема'], dark: ['moon', 'Тёмная', 'Тёмная тема'] };
function setTheme(mode, save) {
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  const [ic, label, title] = THEMES[mode];
  $('#theme').replaceChildren(icon(ic), label);
  $('#theme').title = title + ' — нажмите, чтобы переключить';
  $('#theme').dataset.mode = mode;
  if (save) try { localStorage.setItem('csr-decode:theme', mode); } catch {}
}
$('#theme').addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  setTheme(order[(order.indexOf($('#theme').dataset.mode) + 1) % 3], true);
});
setTheme(document.documentElement.dataset.theme || 'auto', false);

const showOid = $('#showOid');
try { showOid.checked = localStorage.getItem('csr-decode:oid') !== '0'; } catch { showOid.checked = true; }
const syncOid = () => document.body.classList.toggle('hide-oid', !showOid.checked);
showOid.addEventListener('change', () => { syncOid(); try { localStorage.setItem('csr-decode:oid', showOid.checked ? '1' : '0'); } catch {} });
syncOid();

$('#version').textContent = 'v' + APP_VERSION;
