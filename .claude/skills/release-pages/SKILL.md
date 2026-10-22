---
name: release-pages
description: Выпуск новой версии ASN.1 Decoder на GitHub Pages — проверка, поднятие версии, CHANGELOG, тег и пуш в main. Использовать, когда просят «релизнуть», «выпустить версию», «опубликовать на pages» или «задеплоить» этот репозиторий.
---

# Релиз на GitHub Pages

Сайт: https://aiekseu.github.io/asn1-decoder/ · репозиторий: `git@github.com:aiekseu/asn1-decoder.git`.

Публикует workflow `.github/workflows/pages.yml`: на каждый пуш в `main` он гоняет тесты, проверяет, что версии в `src/app.js`, `package.json` и `CHANGELOG.md` совпадают, и выкладывает `index.html`, `assets/`, `src/`. Значит, релиз — это коммит с новой версией в `main`. Незавершённую работу держите в отдельных ветках: всё, что попало в `main`, сразу уходит на сайт.

## Шаги

1. **Чистое состояние.** `git status` без лишних изменений, текущая ветка — `main`, `git pull --ff-only`.

2. **Проверки.**
   ```bash
   npm test
   for f in src/*.js; do node --check "$f"; done
   ```
   Откройте страницу (`npm run serve`, затем http://localhost:8765) и прогоните оба примера и хотя бы один реальный файл: ошибок в консоли нет, сводка и разделы на месте, поиск и переключение темы работают.

3. **(Если давно не обновляли) реестр OID РФ.** `npm run update-registry`. Скрипт откажется перезаписывать файл, если записей подозрительно мало. Посмотрите `git diff --stat src/registry.js` — резкое уменьшение значит, что поменялась вёрстка сайта реестра.

4. **Версия (SemVer).** Патч — исправления и новые названия OID; минор — новые возможности; мажор — несовместимые изменения (например, смена URL или форматов). Поменяйте одинаково в двух местах:
   - `src/app.js` → `const APP_VERSION = 'X.Y.Z';`
   - `package.json` → `"version": "X.Y.Z"`

5. **CHANGELOG.md.** Новый раздел сверху: `## [X.Y.Z] — ГГГГ-ММ-ДД` и пункты по-русски, что поменялось для пользователя. Заголовок обязателен — без него workflow упадёт.

6. **Коммит, тег, пуш.**
   ```bash
   git add -A
   git commit -m "Релиз vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main --follow-tags
   ```

7. **Проверка публикации.** Статус последнего запуска (без gh, через публичный API):
   ```bash
   curl -s "https://api.github.com/repos/aiekseu/asn1-decoder/actions/runs?per_page=1" | python3 -c "import json,sys; r=json.load(sys.stdin)['workflow_runs'][0]; print(r['head_sha'][:7], r['status'], r['conclusion'], r['html_url'])"
   ```
   Когда `completed success`, убедитесь, что на сайте новая версия (кэш Pages обновляется до пары минут):
   ```bash
   curl -s https://aiekseu.github.io/asn1-decoder/src/app.js | grep APP_VERSION
   ```
   В подвале страницы тоже видно `vX.Y.Z`.

## Если что-то пошло не так

- **Workflow упал на «Версии совпадают»** — версия в `src/app.js`, `package.json` и заголовке CHANGELOG различается. Исправьте и запушьте ещё один коммит; тег перевесьте: `git tag -f -a vX.Y.Z -m vX.Y.Z && git push -f origin vX.Y.Z`.
- **Deploy: «Pages site not found» / «Get Pages site failed»** — Pages не включены. Один раз: Settings → Pages → Build and deployment → Source: **GitHub Actions**, затем Actions → Pages → Re-run.
- **Откат** — `git revert <коммит>` и пуш в `main`; предыдущая версия опубликуется заново. Не переписывайте историю `main` силой.

## Чего не делать

- Не коммитить реальные сертификаты и запросы пользователей — в них ФИО, ИНН, СНИЛС, почта. Для примеров только вымышленные реквизиты (как в `src/samples.js`).
- Не переделывать скрипты в ES-модули: страница должна открываться с диска по `file://`.
