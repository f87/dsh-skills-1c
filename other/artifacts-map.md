# Карта артефактов

## Деревья XML (пример проекта)

| Каталог | Что | Объём |
|---|---|---|
| `src\current` | текущая конфигурация с доработками | 128 668 файлов, 10,9 ГБ |
| `src\vendor_erp` | предыдущая поставка ЕРП (2.5.22.186) | 121 712, 8,5 ГБ |
| `src\vendor_uat_old` | модуль УАТ 2.5.21.1 | 7 622, 113 МБ |
| `src\update_erp` | поставка 2.5.27.98 | 124 254, 8,6 ГБ |
| `src\uat_new` | модуль УАТ 2.5.22.1 | 7 652, 110 МБ |
| `src\result_v1`, `src\result_v2` | результаты сборки | 129 000+ файлов |

## Файлы поставок

`current_2_5_22_186.cf` (3,8 ГБ), `vendor_ERP_2_5_22_186.cf` (2,26 ГБ), `vendor_UAT_2_5_21_1.cf` (27 МБ),
`update ERP_2_5_27_98.cf` (1,5 ГБ), результаты `ERP_2_5_27_98_with_mods*.cf` (~1,53 ГБ).

## Инструменты (в разделах `skills-1c`)

| Где | Что |
|---|---|
| `config\` | `manifest.js`, `hash.js`, `filediff.js`, `cmp.js`, `diff.js` — манифесты и SHA1-сравнение деревьев |
| `config\support\`, `config\supply\` | `inspect_bin.js`, `set_levels.js`, `set_flags.js`, `expand_names.js`, `dump_names.js` — правка `.bin`; `bin_summary.js`, `bin_diff.js`, `build_two_deliveries_bin.js`, `load_tree.ps1`, `accept_cf.ps1` — несколько поставок и приёмка |
| `config\update\` | `skel.js`, `copyfrom.js`, `addchild.js`, `addattr.js` — каркас; `objmerge.js`, `syncobjfiles.js` — элементы объектов; `mergetypes.js` — сведение типов; `regmerge.js` — предопределённые; `blockmerge.js`, `merge3v2.js`, `merge3.js` — модули; `multirename2.js`, `renamerefs.js`, `prunetypes.js`, `prunerefs.js`, `fixconfig.js`, `fixrefs.js` — ссылки; `delta-objects.js`, `mergefrom.js`, `reapply-changes.js`, `filter_changed.js` — дельта модуля; `addregrec.js`, `refscan.js`, `dupuuid.js` — контроль |
| `other\` | `pdftext.js` |
| проект | `_work\scripts\build_v1.ps1`, `build_v2.ps1`, `checkmods.js`, `sets.js` — конкретный проект (пример) |

## Данные (остаются в проекте)

Списки и манифесты — в каталоге проекта: `_work\lists` (`removed_by_vendor.json` 449, `removed_renames_ok.json`
116 пар, `removed_keep.json` 338, `to_copy_v1.json` 1 516, `uat_delta*.json`, `uat_owned.json` 1 466,
`uat_changed_owned.json` 77, `replace_procs.json` 4), `_work\reports` (`types_lost_v1.json` — 890 потерянных
типов, `types_apply_example.json`), `_work\manifests` (манифесты деревьев).

## Рабочие каталоги проекта

`_work\ib_*` — файловые базы; `_work\logs` — логи 1С; `_work\lists` — списки; `_work\reports` — отчёты;
`_work\manifests` — манифесты. После сдачи базы и промежуточные отчёты можно удалить, логи — до приёмки нельзя.
