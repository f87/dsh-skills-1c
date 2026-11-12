# config — работа с конфигурацией

| Файл | О чём |
|---|---|
| [`xml-format.md`](xml-format.md) | формат XML-выгрузки: каталоги, `ConfigDumpInfo`, `ParentConfigurations.bin`, `configVersion` |
| [`dump-to-xml.md`](dump-to-xml.md) | выгрузка `.cf` → XML, манифесты, хэши, проверки |
| [`load-from-xml.md`](load-from-xml.md) | загрузка XML в базу: `LoadConfigFromFiles`, `LoadConfigFiles`, `UpdateCfg` |
| [`checkmodules.md`](checkmodules.md) | **синтаксический контроль модулей**: `/CheckModules`, контексты `-ThinClient`/`-Server`, коды `0/101/1`, формат ошибок, грабли |
| [`support.md`](support.md) | поддержка поставщиков: где хранится, способы изменить, два родителя, тупик с `.cfu` |
| [`support-state.md`](support-state.md) | **состояние поддержки в выгрузке**: формат `.bin`, числа уровней, процедуры снять/поставить, проверка |
| [`supply/support-levels.md`](supply/support-levels.md) | **расчёт уровней 0/1**: объект совпал с поставкой → `0`, иначе `1`; корень `0` только если все дети `0`; `2` не используем |
| [`vendor-configs.md`](vendor-configs.md) | **поставки в выгрузке**: `Ext\ParentConfigurations\*.cf` → XML, сколько поставок, формула дельты |
| [`supply/README.md`](supply/README.md) | **несколько поставок в одной конфигурации**: правила, какая поставка главная, сборка `.bin`, загрузка и приёмка (`deliveries.md`, `which-is-main.md`, `build-and-check.md`) |
| [`update/README.md`](update/README.md) | **обновление с сохранением доработок**: конвейер, сведение типов, слияние модулей и объектов, проверка форм, диагностика, приёмка, аудит отличий; БСП-часть — [`update/SSL/`](update/SSL/README.md) |
| [`update/deliveries-invariance.md`](update/deliveries-invariance.md) | **ни один поставщик не теряется при обновлении**: инвариант состава поставок, гейты до/после, восстановление |
| [`edit-xml.md`](edit-xml.md) | **правка XML**: новые реквизиты/ресурсы/ТЧ, изменение типа, новые объекты, подсистемы, корень |
| [`rules.md`](rules.md) | **жёсткие правила R01–R21** — инварианты, нарушение которых даёт нерабочий результат |
| [`cf-cfu-dt.md`](cf-cfu-dt.md) | типы файлов конфигурации, как загружать, чем опасен `.dt` |

## Инструменты (в этом каталоге)

| Инструмент | Назначение |
|---|---|
| `support-state.ps1` | состояние поддержки: просмотр, снятие/постановка уровней, `-EnableChanges`/`-Lock`, сравнение объекта с поставкой |
| `support\inspect_bin.js` | разбор `ParentConfigurations.bin`: заголовок, поставки, записи, хвост (только чтение) |
| `support\set_levels.js` | быстрая установка уровней по списку имён (`expand_names.js` + токены) |
| `support\set_flags.js` | флаги «изменения запрещены» (заголовок/поставки) |
| `support\expand_names.js`, `dump_names.js` | развернуть корневые имена в полные / выгрузить имена поставки |
| `supply\support-levels.js` | расчёт уровней `0/1` по SHA1 дерева против дерева поставки: отчёт, `--delivery` для нескольких поставок, `--write` |
| `supply\support-levels-multi.js` | расчёт уровней `0/1` сразу для всех поставок `.bin` (каждая запись — против своей поставки, `--map`), отчёт и `--write` |
| `supply\bin_summary.js` | структура `.bin` в JSON: `flag`, `count`, `supportGuid`, «своя» поставка, уровни, хвост |
| `supply\bin_diff.js` | сравнение двух `.bin` (любое число поставок) по структуре и записям |
| `supply\build_two_deliveries_bin.js` | собрать `.bin` из двух одноставочных (режимы `vendor`/`adapt`, порядок, флаги) |
| `supply\load_tree.ps1` | дерево → чистая база: `LoadConfigFromFiles`, сообщения, `CheckModules`, выгрузка, `DumpCfg` |
| `supply\accept_cf.ps1` | приёмка `.cf`: `LoadCfg` → `CheckModules` → выгрузка → `.bin`/копии → сверка с эталоном |
| `update\*.js` | сборка и гейты: каркас, сведение типов, элементы объектов, модули, дельта, контроль (`update\README.md`) |
| `update\SSL\*.js` | специфика БСП: `Predefined.xml`, ограничения доступа, состав плана обмена (`update\SSL\README.md`) |
| `manifest.js` | `ConfigDumpInfo.xml` → JSON `[{n, i}]` (имя объекта, id) |
| `hash.js` | SHA1 всех файлов дерева → JSON для сравнения |
| `filediff.js` | сравнение двух хэш-карт: changed / onlyA / onlyB (+ списки и summary) |
| `cmp.js`, `diff.js` | точечное сравнение файлов/деревьев |

Примеры:

```powershell
node config\manifest.js <tree> <out.json>
node config\hash.js <tree> <hash.json>
node config\filediff.js <hashA.json> <hashB.json> <prefix>

pwsh -File config\support-state.ps1 -Tree <tree>                        # что сейчас
pwsh -File config\support-state.ps1 -Tree <tree> -EnableChanges         # снять общий замок
pwsh -File config\support-state.ps1 -Tree <tree> -ObjectName 'Catalog.X' -Level 2
pwsh -File config\support-state.ps1 -Tree <tree> -Compare <vendor tree> # что отличается от поставки

node config\supply\bin_summary.js <tree>\Ext\ParentConfigurations.bin      # структура поддержки
node config\supply\bin_diff.js <a.bin> <b.bin>                            # сравнить два .bin
node config\supply\support-levels.js --bin <tree>\Ext\ParentConfigurations.bin --cdi <tree>\ConfigDumpInfo.xml --vendor-root <vendor> --ours-root <tree> --hashes-vendor <h1>.json --hashes-ours <h2>.json --json <report>.json   # только отчёт
node config\supply\support-levels.js ... --out <tree>\Ext\ParentConfigurations.bin --write                                                  # записать уровни

node config\update\delta-check.js <beforeTree> <afterTree> <vendorTree>   # инвариант дельты
```

## Быстрые правила

1. **Сравнивать деревья только по SHA1 файлов**, не по `configVersion`.
2. **Загружать — только в пустую базу** для контрольной сборки (иначе останутся объекты прошлой сборки).
3. **Успешная загрузка ≠ корректность**: состав определяемых типов проверяется отдельно
   (`config/update/defined-types.md`).
4. **Состояние поддержки живёт в `Ext\ParentConfigurations.bin`**, не в XML объектов. Правится скриптом
   `support-state.ps1`; после загрузки сохраняется (проверено обратной выгрузкой).
5. **На поддержку (уровень 0) ставится только объект, побайтно равный поставке** — проверка `-Compare`.
6. **Правка XML объекта возможна только после снятия замка** (уровень 1/2 или `-EnableChanges`).
7. **Контроль после правки:** `LoadConfigFromFiles` EXIT 0 → `DumpConfigToFiles` → `ParentConfigurations.bin`
   совпал побайтно, остальное дерево — 0 отличий; `ConfigDumpInfo.xml` отличается только `configVersion`.
8. **`.cf` детерминирован только внутри одной базы:** два `DumpCfg` подряд дают одинаковый файл, а две базы
   из одного дерева — разные MD5 при идентичном содержимом. Сравнивайте по XML и `.bin`, MD5 `.cf`
   фиксируйте как идентификатор сборки.
9. **Синтаксис модулей — только `CheckModules -ThinClient -Server`.** Без флагов ключ не проверяет ничего,
   одиночный `-ThinClient` пропускает серверные модули ([`checkmodules.md`](checkmodules.md)).
10. **Доработки = [текущая конфигурация] − [все поставки]**. Поставки — `Ext\ParentConfigurations\*.cf`
    (файл на поставку), их выгружают в XML и сравнивают; формула одна до и после обновления
    ([`vendor-configs.md`](vendor-configs.md), [`update/delta-invariance.md`](update/delta-invariance.md)).
11. **Несколько поставок в `.bin` — норма** (1С принимает и сохраняет файл байт-в-байт). Главная поставка —
    первая, `flag=0` каждой поставке, чья копия `.cf` нужна; приёмка — полным циклом, а не по коду возврата
    `LoadCfg` ([`supply/README.md`](supply/README.md)).

12. **Уровни не копируйте, а считайте**: в собранной конфигурации только `0`/`1` — объект, побайтно равный
    поставке, `0`, любое отличие `1`; уровень `2` снимает объект с автообновления поставщика
    ([`supply/support-levels.md`](supply/support-levels.md)).