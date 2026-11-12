# Обновление версии модуля (пример: УАТ 2.5.21.1 → 2.5.22.1)

> Пример конкретного проекта. Инструменты (`config\update\delta-objects.js`, `config\update\mergefrom.js`, `config\update\reapply-changes.js`)
> универсальны; пути `src\...`, `work\...` и имена списков — из этого примера.

Реализация: пример конвейера — `<проект>\_work\scripts\build_v2.ps1`; универсальные шаги —
`config\update\delta-objects.js`, `config\update\mergefrom.js`, `config\update\reapply-changes.js`, `config\update\filter_changed.js`.

## Почему нельзя «просто заменить объекты УАТ»

Поставка модуля УАТ собрана на **другой версии ERP** (2.5.22.1 — на 2.5.27.49). Наивная замена всех объектов
УАТ в базе 2.5.27.98 даёт **6358 сообщений** загрузки: дубли `InternalInfo`, ссылки на переименованные
реквизиты, несоответствия планов. Рабочий путь — **дельта + переименования + чистка**.

## Ключевые факты

1. Поставка УАТ содержит не только свои объекты: 288 объектов — это объекты ЕРП версии .49. Их копировать
   **нельзя** (дубли UUID). Принадлежность определяется по UUID (манифесты), не по имени.
2. «Наши» изменения внутри УАТ — в основном шаблоны/справки; модули `слк*`/`уат*` зашифрованы (`Module.bin`)
   и не сливаются.
3. Изменения между версиями УАТ считаются по **файловым хэшам** (SHA1), а не по `configVersion`.

## Шаги

1. Хэши и дельта между `uat_old` и `uat_new`:

```powershell
node config\hash.js     src\uat_new   work\hash_uat_new.json
node config\filediff.js work\hash_uat_old.json work\hash_uat_new.json work\fd_uatold_uatnew
node config\update\delta-objects.js work\fd_uatold_uatnew-changed.json work\fd_uatold_uatnew-onlyB.json src\uat_new work\uat_delta.json
```

2. Разделить объекты дельты на УАТ-принадлежащие и объекты ЕРП (по UUID): 98 + 9 в проекте.
3. Основа — уже собранный результат V1; заменить УАТ-объекты **с удалением старых файлов**:

```powershell
node config\update\copyfrom.js src\uat_new work\result_v2 work\uat_delta_uat.json replace
node config\update\mergefrom.js src\uat_new src\vendor_uat_old work\result_v2 work\result_v2 work\uat_delta_erp.json
```

4. Вернуть наши правки только по файлам УАТ-объектов (иначе перезапишете объекты ЕРП версией .49):

```powershell
node config\update\filter_changed.js work\fd_uat_ours-changed.json work\uat_owned.json src\uat_new work\uat_changed_owned.json
node config\update\reapply-changes.js work\uat_changed_owned.json src\vendor_uat_old src\uat_new src\current work\result_v2 work\uat_reapply.json
```

5. Новые объекты — в `ChildObjects` (`addchild.js`), файлы форм/макетов — `syncobjfiles.js`, предопределённые —
   `regmerge.js predefined` (донор — `uat_new`), определяемые типы — `mergetypes.js` (см. `defined-types.md`).
6. Переименования ЕРП .49 → .98 — `multirename2.js` (116 пар), затем `prunetypes.js` / `prunerefs.js` /
   `fixconfig.js`.
7. Загрузка/проверки — `acceptance.md`.

## Результат проекта

`LoadConfigFromFiles` EXIT 0 за 49,1 мин; 28 предупреждений (25 ссылок УАТ на переименованные реквизиты ЕРП
+ 3 справки); `CheckModules` EXIT 0. **Но** сборка забракована из-за типов: в `mergetypes` для V2 тоже
требуется объединение с приоритетом current (это уже учтено в `build_v2.ps1`).

## Чего нельзя

- Возвращать удалённые поставщиком объекты «чтобы ссылки сошлись» (1078 несоответствий планов).
- Копировать ERP-объекты из `uat_new`.
- Заменять `FilterCriteria/СвязанныеДокументы.xml` версией УАТ (ссылки на удалённые реквизиты).
