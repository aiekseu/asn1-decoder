// Тесты разбора без браузера: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Скрипты страницы — обычные (не модули) и делят глобальную область, поэтому склеиваем их в один
const FILES = ['registry', 'oids', 'asn1', 'hash', 'decoder', 'samples'];
const code = FILES.map(f => readFileSync(new URL(`../src/${f}.js`, import.meta.url), 'utf8').replace("'use strict';", '')).join('\n');
const ctx = vm.createContext({ TextDecoder, atob, console });
vm.runInContext(`'use strict';\n${code}\n;globalThis.api = { SAMPLES, blobsFromText, classify, buildCert, buildCsr, nameGet, registryHint, oidName, fixMojibake, checkInn, checkOgrn, checkSnils, sha1, sha256, UserError };`, ctx);
const api = ctx.api;

const decode = text => api.blobsFromText(text).flatMap(b => api.classify(b)).map(it => it.kind === 'cert' ? api.buildCert(it) : api.buildCsr(it));

test('пример сертификата разбирается целиком', () => {
  const [m] = decode(api.SAMPLES.cert);
  assert.equal(m.kind, 'cert');
  assert.equal(api.nameGet(m.subject, '1.2.643.100.1'), '1027799999996');
  assert.equal(api.nameGet(m.issuer, '2.5.4.3'), 'АО "ТЕСТОВЫЙ УЦ"');
  assert.equal(m.sha1Thumb, 'da17dce1cefe1eccb87ee478b99692e6f885bc5e');
  assert.equal(m.spki.short, 'ГОСТ Р 34.10-2012 (256 бит)');
  assert.equal(m.spki.keyRow.note.kind, 'ok', 'идентификатор ключа совпадает с SKI');
  assert.ok(m.hasQualified);
});

test('пример запроса разбирается вместе с атрибутами', () => {
  const [m] = decode(api.SAMPLES.csr);
  assert.equal(m.kind, 'csr');
  assert.equal(m.csp, 'Crypto-Pro GOST R 34.10-2012 Cryptographic Service Provider');
  assert.ok(m.sections.some(s => s.id === 'attrs'));
});

test('Base64 без заголовков и с пробелами вместо переводов строк', () => {
  const body = api.SAMPLES.cert.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ' ');
  assert.equal(decode(body)[0].kind, 'cert');
  const oneLine = api.SAMPLES.csr.replace(/\n/g, ' ');
  assert.equal(decode(oneLine)[0].kind, 'csr');
});

test('мусор даёт понятную ошибку', () => {
  assert.throws(() => decode('hello world'), e => e instanceof api.UserError);
});

test('контрольные суммы реквизитов', () => {
  assert.equal(api.checkInn('7709999018'), true);
  assert.equal(api.checkInn('770999999963'), true);
  assert.equal(api.checkInn('007709999018'), true, 'ИНН ЮЛ, дополненный нулями');
  assert.equal(api.checkInn('7709999019'), false);
  assert.equal(api.checkOgrn('1027799999996'), true);
  assert.equal(api.checkSnils('98765432183'), true);
  assert.equal(api.checkSnils('98765432184'), false);
});

test('хеши совпадают с эталонными', () => {
  const abc = new Uint8Array([0x61, 0x62, 0x63]);
  assert.equal(api.sha1(abc), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(api.sha256(abc), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('справочники и реестр', () => {
  assert.equal(api.oidName('1.2.643.6.3.1.2.2'), 'ЭТП: физическое лицо');
  assert.equal(api.registryHint('1.2.643.6.48'), 'OID организации: ООО "АТЦ"');
  assert.match(api.registryHint('1.2.643.3.88.3.1'), /^Ветка 1\.2\.643\.3\.88 — /);
  assert.equal(api.registryHint('1.3.6.1.4.1.99'), null);
});

test('исправление строк, закодированных в UTF-8 дважды', () => {
  assert.equal(api.fixMojibake('ÐšÑ€Ð¸Ð¿Ñ‚Ð¾ÐŸÑ€Ð¾'), 'КриптоПро');
  assert.equal(api.fixMojibake('КриптоПро'), 'КриптоПро');
});
