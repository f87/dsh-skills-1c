# other — остальное

| Файл | О чём |
|---|---|
| [`reports-handover.md`](reports-handover.md) | какие отчёты делать, что фиксировать, как передавать результат |
| [`decisions-log.md`](decisions-log.md) | журнал решений по обновлению ERP 2.5.27.98 и выводы |
| [`known-limitations.md`](known-limitations.md) | ограничения результата и как о них говорить |
| [`artifacts-map.md`](artifacts-map.md) | карта каталогов, файлов, инструментов, логов, баз |
| [`eventlog/`](eventlog/README.md) | журнал регистрации 1С: формат `.lgp`/`.lgf`, разбор без платформы, загрузка в SQLite, анализ |

## Инструменты

| Инструмент | Назначение |
|---|---|
| `pdftext.js` | извлечение текста из PDF (например, инструкция поставщика) — `node other\pdftext.js <pdf> <out.txt>` |
| `eventlog\parse_lgp.py`, `eventlog\parse_lgf.py`, `eventlog\load_sqlite.py`, `eventlog\read_record.py` | разбор журнала регистрации 1С (`.lgp`/`.lgf`) → TSV, справочник, SQLite; Python 3, без зависимостей — [`eventlog/README.md`](eventlog/README.md) |

Журнал решений и ограничения — пример конкретного проекта: решения по другим обновлениям оформляйте
по тем же правилам (что решили → что фактически сделали → что не повторять).
