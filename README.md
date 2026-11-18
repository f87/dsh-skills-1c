# skills-1c — универсальная база знаний по 1С (для людей и агентов)

Каталог для повторного использования при обновлениях любых конфигураций 1С на платформе 8.3.
Знания проверены на практике (обновление ERP 2.5.27.98 + модуля УАТ, Октябрь 2026), но материал и
инструменты не привязаны ни к конфигурации, ни к билду платформы: **подходит любая установленная версия
`8.3.27.*` и ниже** (примеры помечены, конкретные версии/поставки — из проекта проверки).

## Разделы

| Раздел | Что внутри |
|---|---|
| [`1cv8/`](1cv8/README.md) | запуск `1cv8.exe` (пользовательский режим и Конфигуратор), окружение, CLI, грабли, тайминги |
| [`config/`](config/README.md) | выгрузка/загрузка конфигурации (XML и `.cf`), формат выгрузки, поддержка поставщиков, правка XML, правила, `.cf/.cfu/.dt`; скрипты сравнения деревьев и манифестов |
| [`config/support/`](config/support-state.md) | разбор и правка `Ext\ParentConfigurations.bin`: уровни, флаги, имена поставки (документ — [`support-state.md`](config/support-state.md)) |
| [`config/supply/`](config/supply/README.md) | **несколько поставок в одной конфигурации**: правила, какая поставка главная, сборка `.bin`, загрузка и приёмка, расчёт уровней поддержки 0/1 |
| [`config/update/`](config/update/README.md) | обновление конфигурации: конвейер, сведение типов и составные типы, слияние модулей BSL, слияние объектов, проверка форм, диагностика, приёмка; инструменты сборки |
| [`config/update/SSL/`](config/update/SSL/README.md) | **специфика БСП** (основа типовых конфигураций): `Predefined.xml` (`ИдентификаторыОбъектовМетаданных`), списки ограничения доступа, план обмена БИД |
| [`other/`](other/README.md) | отчёты и передача, журнал решений (пример проекта), ограничения, карта артефактов, утилиты; журнал регистрации 1С — [`other/eventlog/`](other/eventlog/README.md) |

## Изменения хранилища

Владелец и администратор — пользователь `KulshaAV` (каталог `skills-1c`) и агент, действующий по его прямому поручению.
**Другим агентам вносить правки запрещено:** только чтение и предложения текстом (файл → что изменить →
почему → чем проверено). Полный регламент, порядок изменения и требования к фактам —
[`AGENTS.md`](AGENTS.md).

## Быстрый старт

- **Не знаю, где установлена 1С / какая версия** → [`1cv8/environment.md`](1cv8/environment.md), «Платформа»
  (подходит любая `8.3.27.*` и ниже; путь к `1cv8.exe` берётся с машины)
- Нужно запустить 1С из командной строки → [`1cv8/launch-modes.md`](1cv8/launch-modes.md)
- Не запускается / странный код возврата → [`1cv8/cli-gotchas.md`](1cv8/cli-gotchas.md)
- Надо выгрузить конфигурацию в XML → [`config/dump-to-xml.md`](config/dump-to-xml.md)
- Надо собрать конфигурацию из XML → [`config/load-from-xml.md`](config/load-from-xml.md)
- **Проверить синтаксис модулей** → [`config/checkmodules.md`](config/checkmodules.md)
  (запускать `-ThinClient -Server`; без флагов проверка ничего не делает)
- **Разобрать журнал регистрации 1С** (`.lgp`/`.lgf` → SQLite, без платформы) → [`other/eventlog/README.md`](other/eventlog/README.md)
- Нужна поддержка двух поставщиков → [`config/support.md`](config/support.md)
- **В `.bin` несколько поставок / надо собрать такой файл** → [`config/supply/README.md`](config/supply/README.md)
  (главная поставка первой, `flag=0` обеим, приёмка полным циклом)
- **Снять / поставить объект на поддержку в XML-выгрузке** → [`config/support-state.md`](config/support-state.md)
  (инструмент — `config/support-state.ps1`); жёсткие правила — [`config/rules.md`](config/rules.md)
- **Добавить реквизит / новый объект / подсистему в выгрузку** → [`config/edit-xml.md`](config/edit-xml.md)
- Обновление с сохранением доработок → [`config/update/pipeline.md`](config/update/pipeline.md)
- **Проверить, что доработки не потеряны, а расхождение не выросло** → [`config/update/delta-invariance.md`](config/update/delta-invariance.md)
  (инструмент — `config/update/delta-check.js`)
- **Сводятся типы данных / составные типы** → [`config/update/defined-types.md`](config/update/defined-types.md) (обязательно к прочтению: потеря типов = потеря данных)
- Слияние модулей с учётом имён методов → [`config/update/merge-modules.md`](config/update/merge-modules.md)
- **Грабли слияния и приёмки** → [`config/update/traps.md`](config/update/traps.md)
- **Доказать соответствие поставке (аудит отличий)** → [`config/update/vendor-audit.md`](config/update/vendor-audit.md)
- Проверка форм → [`config/update/check-forms.md`](config/update/check-forms.md)
- Не грузится конфигурация → [`config/update/diagnostics.md`](config/update/diagnostics.md)

## Инструменты

Скрипты лежат рядом с документами своих разделов (3 раздела: `1cv8`, `config`, `other`; в `config\` —
подразделы `support\`, `supply\`, `update\`, в `update\` — БСП-часть `SSL\`, в `other\` — `eventlog\`):

| Где | Инструменты |
|---|---|
| `config\` | `support-state.ps1` (состояние поддержки в `.bin`: просмотр/правка), `manifest.js` (ConfigDumpInfo → JSON), `hash.js` + `filediff.js` (SHA1-сравнение деревьев), `cmp.js`, `diff.js` |
| `config\supply\` | `bin_summary.js`, `bin_diff.js` (структура и сравнение `.bin`), `build_two_deliveries_bin.js` (сборка `.bin` с несколькими поставками), `load_tree.ps1`, `accept_cf.ps1` (загрузка дерева и приёмка `.cf` полным циклом), `support-levels.js` (расчёт уровней поддержки 0/1), `support-levels-multi.js` (то же сразу для всех поставок `.bin`) |
| `config\update\` | `skel.js`, `copyfrom.js`, `addchild.js`, `addattr.js` (каркас); `objmerge.js`, `syncobjfiles.js` (элементы объектов); `mergetypes.js` (сведение типов); `blockmerge.js`, `merge3v2.js`, `merge3.js` (модули); `multirename2.js`, `renamerefs.js`, `prunetypes.js`, `prunerefs.js`, `fixconfig.js`, `fixrefs.js` (ссылки); `mergefrom.js`, `filter_changed.js`, `delta-objects.js`, `reapply-changes.js` (дельта модуля); `addregrec.js`, `refscan.js`, `dupuuid.js`; `checkprocs.js`, `carryprocs.js`, `checknames.js`, `checkvendorchanges.js`, `diffbuilds.js`, `delta-check.js` (гейты) |
| `config\update\SSL\` | `regmerge.js` (предопределённые БСП по `<Item id>`), `checkpredefined.js`, `checkaccesslists.js`, `checkplancontent.js`, `fixplancontent.js` |
| `other\` | `pdftext.js` (извлечение текста из PDF); `eventlog\` — `parse_lgp.py`, `parse_lgf.py`, `read_record.py`, `load_sqlite.py` (журнал регистрации 1С: `.lgp`/`.lgf` → TSV/SQLite, Python 3 без зависимостей) |

**Проектные** инструменты и данные остаются в каталоге проекта (пример:
`<проект>\_work\scripts\build_v1.ps1`, `checkmods.js`, `sets.js`; списки — `_work\lists`).

Все универсальные инструменты принимают пути аргументами; списки/манифесты — тоже аргументы, поэтому
переносить их вместе со скриптами не нужно. `mergetypes.js` берёт карту переименований из необязательного
аргумента `renames.json`; `SSL\regmerge.js` — список каталогов для `Predefined.xml` (по умолчанию типовые
каталоги доп. реквизитов и идентификаторов БСП).
