# update — обновление конфигурации с сохранением доработок

Подраздел `config\update\`: обновление конфигурации, у которой есть доработки. Специфика БСП, которая
не универсальна для любой 1С, — в [`SSL/`](SSL/README.md).

| Файл | О чём |
|---|---|
| [`pipeline.md`](pipeline.md) | полный конвейер сборки: база → каркас → предопределённые → типы → элементы → модули → загрузка |
| [`defined-types.md`](defined-types.md) | **сведение типов данных и составные типы** (критическое правило) |
| [`merge-modules.md`](merge-modules.md) | склейка модулей BSL с учётом структуры и имён методов |
| [`merge-objects.md`](merge-objects.md) | добавление реквизитов/ТЧ/форм/макетов к объектам поставщика |
| [`check-forms.md`](check-forms.md) | проверка форм: что и как проверять, типовые ошибки |
| [`renames-refs.md`](renames-refs.md) | переименования поставщика (`Удалить…`), чистка ссылок |
| [`module-upgrade.md`](module-upgrade.md) | обновление версии модуля (пример: УАТ 2.5.21.1 → 2.5.22.1) |
| [`diagnostics.md`](diagnostics.md) | таблица «сообщение загрузки → причина → лечение» |
| [`delta-invariance.md`](delta-invariance.md) | **правило: перечень доработок не меняется от обновления** (не потерять доработки, не увеличить расхождение) |
| [`deliveries-invariance.md`](deliveries-invariance.md) | **правило: ни один поставщик не теряется** — сколько поставок было, столько осталось; менять можно только порядок |
| [`traps.md`](traps.md) | **грабли слияния и приёмки**: маркеры, carryprocs, renamerefs, слепые зоны `CheckModules` |
| [`SSL/`](SSL/README.md) | **специфика БСП**: `Predefined.xml` (`ИдентификаторыОбъектовМетаданных`, `Наборы…`), списки ограничения доступа, план обмена БИД |
| [`vendor-audit.md`](vendor-audit.md) | доказуемое соответствие поставке: хэш-диф, имена, `Predefined`, diff сборок, архив |
| [`acceptance.md`](acceptance.md) | критерии приёмки, включая типы, инвариант дельты и инвариант поставок |

Состояние поддержки объектов при сборке (что можно ставить на поддержку, как снять замок, как проверить
`ParentConfigurations.bin`) — [`../support-state.md`](../support-state.md),
правка XML — [`../edit-xml.md`](../edit-xml.md).

## Инструменты (в этом каталоге)

| Инструмент | Шаг |
|---|---|
| `skel.js`, `copyfrom.js`, `addchild.js`, `addattr.js` | каркас результата, добавление объектов/реквизитов |
| `objmerge.js`, `syncobjfiles.js` | слияние элементов объекта и файлов форм/макетов |
| `mergetypes.js` | **объединение определяемых типов с приоритетом текущей конфигурации** |
| [`SSL\regmerge.js`](SSL/README.md) | предопределённые БСП (по `<Item id>`, фильтр orphan) |
| `blockmerge.js`, `merge3v2.js`, `merge3.js` | слияние модулей; маркеры блоков — `markers.json` |
| `multirename.js`, `multirename2.js`, `renamerefs.js`, `renameattr.js` | переименования по UUID / имени |
| `prunetypes.js`, `prunerefs.js`, `fixconfig.js`, `fixrefs.js` | чистка мёртвых ссылок и записей состава |
| `delta-objects.js`, `mergefrom.js`, `reapply-changes.js`, `filter_changed.js` | дельта модуля (по файловым хэшам) |
| `addregrec.js`, `refscan.js`, `dupuuid.js` | регистратор регистра, поиск ссылок, дубли UUID |
| `delta-check.js` | **проверка инварианта дельты**: сравнение доработок до/после обновления против поставки(ок) |
| `checkprocs.js` | дубли/обрывы процедур, баланс маркеров (`markers.json`) |
| `carryprocs.js` | перенос процедур без разметки, до неподвижной точки |
| `checknames.js`, `checkvendorchanges.js` | аудит: имена объектов, хэш-диф с поставкой; `Predefined` — `SSL/checkpredefined.js` |
| `diffbuilds.js` | машинный diff двух manifest сборок |

## Минимальный порядок

```
1) деревья (config/dump-to-xml.md)
2) каркас результата (pipeline.md, шаги 1–3)
3) определяемые типы — объединение с приоритетом current (defined-types.md)  ← без этого сборка непригодна
4) элементы объектов и модули (merge-objects.md, merge-modules.md)
5) **инвариант дельты** — delta-check.js (delta-invariance.md): lost=0, new=0
6) загрузка/CheckModules/DumpCfg/контрольная загрузка (acceptance.md)
```

Если поставщиков несколько — п.5 дополняется **инвариантом поставок** (`deliveries-invariance.md`):
состав и порядок поставок в `Ext\ParentConfigurations.bin` на входе и на выходе совпадают.

## Чего нельзя

- Загружать дерево, в `.bin` которого меньше поставок, чем у конфигурации: 1С молча затрёт остальные
  ([`deliveries-invariance.md`](deliveries-invariance.md)).
- Уменьшать состав определяемых типов (теряются данные; на пустой базе не видно).
- Сливать составы типов ПВХ «по номеру блока».
- Копировать объекты другой конфигурации из поставки модуля (дубли `InternalInfo`).
- Заменять `>Имя<` по всему дереву (портит `<Name>` и `Configuration.xml`).
