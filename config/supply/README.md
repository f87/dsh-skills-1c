# supply — несколько поставок в одной конфигурации

Раздел про случай, когда в `.bin` поддержки не одна поставка, а несколько: основной продукт +
отраслевой модуль (дополнение), либо надо собрать такой файл самому, либо понять, почему 1С «потеряла»
поставку или копию `*.cf`.

Универсально: любая конфигурация 8.3, любые поставки. Проверено 8.3.27.1859, 28.10.2026.

| Файл | О чём |
|---|---|
| [`deliveries.md`](deliveries.md) | **правила**: 1С принимает несколько поставок, флаг ⇒ копия, содержимое не зависит от числа поставок, что проверяет 1С, гипотезы, грабли |
| [`which-is-main.md`](which-is-main.md) | **какая поставка главная** и почему она идёт первой (признаки, что не является признаком) |
| [`build-and-check.md`](build-and-check.md) | сборка `.bin`, подготовка дерева, загрузка, приёмка «полным циклом», критерии, типовые отказы |
| [`support-levels.md`](support-levels.md) | **уровни поддержки 0/1**: правило, алгоритм расчёта, инструменты (одна и несколько поставок), гейты, ограничения, пример результата |

Смежное (в `config/`): формат `.bin` и уровни — [`../support-state.md`](../support-state.md),
постановка/снятие поддержки и «два родителя» — [`../support.md`](../support.md), копии поставок в
выгрузке и формула дельты — [`../vendor-configs.md`](../vendor-configs.md), жёсткие правила —
[`../rules.md`](../rules.md).

## Инструменты

| Инструмент | Назначение |
|---|---|
| `bin_summary.js` | структура `.bin` в JSON: размер, SHA1, `flag`, `count`, `supportGuid`, «своя» поставка, хвост, по поставкам — `parentGuid`, уровни, режимы |
| `bin_diff.js` | сравнение двух `.bin` (любое число поставок): поставки по имени, записи по `uuid`; коды `0/1/2` |
| `build_two_deliveries_bin.js` | сборка `.bin` из двух одноставочных: режимы `vendor`/`adapt`, порядок, заголовочный `supportGuid`, флаги, при необходимости фильтр по `ConfigDumpInfo`; dry-run по умолчанию |
| `load_tree.ps1` | загрузка дерева в чистую базу: `LoadConfigFromFiles`, классы сообщений, `CheckModules`, `DumpConfigToFiles` (+ SHA1/структура `.bin`, копии), `DumpCfg`; сводка в JSON |
| `accept_cf.ps1` | приёмка `.cf`: `LoadCfg` → `CheckModules` → выгрузка → структура `.bin` и копии → сверка с эталоном; вердикт и код возврата |
| `support-levels.js` | расчёт уровней `0/1` по SHA1: отчёт, `--delivery` для нескольких поставок, `--only`, `--write` |
| `support-levels-multi.js` | расчёт уровней `0/1` сразу для всех поставок `.bin` (каждая запись — против своей поставки), `--map`, `--json-details`, `--write` |

Разбор `.bin` во всех инструментах раздела — из [`../support/inspect_bin.js`](../support/inspect_bin.js)
(единый парсер: BOM, одна строка, `}` у последнего токена).

Примеры:

```powershell
node config\supply\bin_summary.js <tree>\Ext\ParentConfigurations.bin
node config\supply\bin_diff.js <a.bin> <b.bin>

node config\supply\build_two_deliveries_bin.js --main <main.bin> --extra <extra.bin> `
  --mode vendor --order main --header main --flag 0 --flag-main 0 --flag-extra 0 `
  --out <new.bin> --write

pwsh -File config\supply\load_tree.ps1 -Tree <tree> -Ib <ib>\ib_load -LogDir <logs> -Tag load1 -CheckModules
pwsh -File config\supply\accept_cf.ps1 -Cf <cf> -Ib <ib>\ib_cf -LogDir <logs> -Tag cf1 -Baseline <tree> -Force

node config\supply\support-levels-multi.js --bin <tree>\Ext\ParentConfigurations.bin `
  --ours-root <tree> --hashes-ours <h_ours>.json --map <map>.json --json <report>.json
```

## Коротко

1. **1С принимает несколько поставок** и сохраняет `.bin` байт-в-байт. Прежнее «не принимает» — ошибка
   диагностики (висячие ссылки, а не поставки).
2. **Главная поставка — первая** (по конвенции; 1С порядок не сверяет).
3. **`flag=0` каждой поставке, копия которой нужна**; `flag=1` — 1С удалит её `.cf`.
4. **Копии — байтовые копии вендорских `.cf`**, по одной на поставку с `flag=0`.
5. **Содержимое не зависит от числа поставок**: отличия от одноставочного эталона — только `.bin`,
   `ConfigDumpInfo.xml` и добавленная копия.
6. **Приёмка — полный цикл**, а не код возврата `LoadCfg`.
