# Выгрузка конфигурации в XML

## Когда

Получен новый `.cf`/`.cfu` (поставка, модуль, текущая конфигурация) — нужно дерево для сравнения и слияния.

## Шаги

1. Создать пустую файловую базу:

```powershell
$ib = "<work>\ib_<имя>"
Remove-Item $ib -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $ib | Out-Null
& $exe CREATEINFOBASE "File='$ib'" /Out"<log>\create.log" /DisableStartupDialogs /DisableStartupMessages
```

2. Загрузить конфигурацию:

```powershell
& $exe DESIGNER /F"$ib" /LoadCfg"<файл>.cf" /Out"<log>\load.log" /DisableStartupDialogs /DisableStartupMessages
```

3. Выгрузить в XML:

```powershell
$tree = "<src>\<имя>"
Remove-Item $tree -Recurse -Force -ErrorAction SilentlyContinue
& $exe DESIGNER /F"$ib" /DumpConfigToFiles"$tree" /Out"<log>\dump.log" /DisableStartupDialogs /DisableStartupMessages
```

> Поставки из `Ext\ParentConfigurations\*.cf` выгружаются так же — по одной на чистую базу,
> см. [`vendor-configs.md`](vendor-configs.md).

4. Проверить: `EXIT 0`; `Configuration.xml` содержит `<Version>`, `<Vendor>`; `Ext\ParentConfigurations.bin`
   содержит ожидаемого родителя; число файлов/размер близки к эталону (пример: ERP ≈ 120–128 тыс., 8–11 ГБ;
   УАТ ≈ 7,6 тыс., 110 МБ).

5. Построить манифест и хэши:

```powershell
node config\manifest.js $tree <work>\manifests\objects_<имя>.json
node config\hash.js     $tree <work>\lists\hash_<имя>.json
```

## Проверка

```powershell
(Get-ChildItem $tree -Recurse -File | Measure-Object).Count
(Get-Item "$tree\ConfigDumpInfo.xml").Length -gt 0
```

## Грабли

- 10–12 мин на крупной конфигурации (пример: ERP) — запускать в фоне.
- Пробелы в имени `.cf` — кавычки.
- `ConfigDumpInfo.xml` перезаписывается; для «до/после» сохраните копию.
- **Про старый реестр.** Ранее считалось, что оставленный `ConfigDumpInfo.xml` мешает загрузке. Проверено
  20.10.2026 (8.3.27.1859): полная `LoadConfigFromFiles` перечитывает файлы и при устаревших
  `configVersion` — изменение в модуле применилось, `configVersion` пересчитан, выгрузка совпала.
  То есть удаление реестра **не обязательное условие**, но полезно для воспроизводимости сборки
  (и для сравнения «до/после» без шума версий). См. `config/update/pipeline.md`.
