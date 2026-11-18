# База SQLite: схема, загрузка, запросы

Когда применять: журнал нужен для многократных запросов и срезов, а читать файл каждый раз
дорого. SQLite даёт **один файл**, **ноль зависимостей** (`sqlite3` входит в Python) и
**не требует сервера** — журнал в 20 ГБ обрабатывается обычным ноутбуком или рабочей станцией.

Проверено 18.11.2026 на срезе 1 ГиБ (9 306 617 записей): разбор в TSV 112 с, загрузка 52 с,
12 индексов 82 с, база 2,3 ГиБ. Журнал 21,5 ГБ / 198,3 млн записей — это ≈48 ГиБ базы
и полтора-два часа на всё (см. «Сколько это стоит»).

## Почему SQLite, а не сервер

| Задача | SQLite | Серверная СУБД |
|---|---|---|
| один-два файла журнала, свои запросы | **да** — файл и `sqlite3` | избыточно |
| 200+ млн строк, аналитика по индексам | **да** — 48 ГиБ, срез за секунды | тоже да |
| несколько человек одновременно пишут | нет (один писатель) | да |
| потоковая запись в реальном времени | нет | да |
| перенос базы на другую машину | **файл целиком** | дамп/реплика |

Ограничения SQLite для этой задачи не мешают: журнал загружается пакетно, а читается
запросами. Параллельная запись и `GROUP BY` по всей таблице без индекса — единственное,
чего избегать.

## Схема

```sql
CREATE TABLE events (
  id        INTEGER PRIMARY KEY,       -- rowid, без AUTOINCREMENT: вставка дешевле
  ts        INTEGER NOT NULL,          -- YYYYMMDDHHMMSS
  day       INTEGER NOT NULL,          -- считается при загрузке, не генерируемый столбец
  hour      INTEGER NOT NULL,          -- так схема работает на любой версии SQLite
  ev        INTEGER NOT NULL,
  sev       TEXT    NOT NULL,          -- I/E/W/N
  st        TEXT    NOT NULL,          -- C/U/N/R
  usr       INTEGER NOT NULL,
  comp      INTEGER NOT NULL,
  app       INTEGER NOT NULL,
  conn      INTEGER NOT NULL,
  meta      INTEGER NOT NULL,
  data      TEXT    NULL,              -- поле «Данные» как есть
  comment   TEXT    NULL,              -- поле «Комментарий»: текст ошибки
  sess      INTEGER NOT NULL,
  tx_time   INTEGER NULL,
  tx_num    INTEGER NULL,
  tx_signed INTEGER NULL,
  off       INTEGER NOT NULL,          -- смещение записи в файле
  src       TEXT    NOT NULL           -- имя файла .lgp (off без него неоднозначен)
);

CREATE INDEX ix_ts       ON events(ts);
CREATE INDEX ix_day      ON events(day, hour);
CREATE INDEX ix_ev       ON events(ev);
CREATE INDEX ix_usr      ON events(usr);
CREATE INDEX ix_app      ON events(app);
CREATE INDEX ix_meta     ON events(meta);
CREATE INDEX ix_sess     ON events(sess);
CREATE INDEX ix_tx       ON events(tx_signed);
CREATE INDEX ix_txp      ON events(tx_time, tx_num);
CREATE INDEX ix_ev_usr   ON events(ev, usr);
CREATE INDEX ix_ev_app   ON events(ev, app);
CREATE INDEX ix_src_off  ON events(src, off);
```

Решения и почему:

- `ts` числом: не нужен разбор строки, диапазоны идут по индексу; `day`/`hour` — **обычные
  столбцы**, их считает загрузчик (генерируемые столбцы появились в SQLite 3.31 и на вставке
  дороже, а совместимость важнее).
- `data`/`comment` — `TEXT`: в промышленном журнале встречаются значения в тысячи символов,
  фиксированная длина обрезала бы молча.
- `comment` — поле 10 записи, **текст сообщения об ошибке** (со стеком). Без него нельзя
  группировать ошибки: `data` описывает объект операции, а не сообщение.
- `tx_time` + `tx_num` — пара для связки «начало ↔ фиксация»; `tx_signed` — то, что показывает
  интерфейс 1С (младшие 32 бита со знаком).
- `off` + `src` — чтобы поднять оригинал записи ([`read_record.py`](read_record.py)).
- Префиксного индекса по `TEXT` в SQLite нет: точные совпадения и `LIKE '…%'` по `data`
  идут полным проходом. Если такие запросы нужны часто —
  `CREATE INDEX ix_data ON events(data)` и принять раздувание базы.

## Загрузка

```bash
# 1. выгрузка (CSV здесь не подходит: он для Excel — с BOM и ';')
python parse_lgp.py --input <журнал.lgp> --out events.tsv --format tsv

# 2. таблица + данные + индексы + сверка.
#    --expect: при выгрузке всего файла — «маркеров (учтено)» из шага 1;
#    при выгрузке среза (--limit) — «разобрано»: последняя запись среза не дочитывается.
python load_sqlite.py --tsv events.tsv --db eventlog.sqlite --expect <строк>

# 3. справочники кодов — в ту же базу
python parse_lgf.py --input 1Cv8.lgf --sqlite eventlog.sqlite
```

Что делает `load_sqlite.py`:

- `PRAGMA journal_mode=OFF`, `synchronous=OFF` — база строится с нуля, журнал SQLite не нужен;
  с `--keep` и `--only-indexes` включаются WAL и `synchronous=NORMAL`, чтобы сбой не портил
  рабочую базу;
- `cache_size` — 512 МБ по умолчанию (`--cache-mb`), `temp_store=MEMORY`, `mmap_size` 256 МБ;
- вставка пачками (50 000 строк) в **одной** транзакции — коммит на пачку замедляет в десятки раз;
- прогресс каждые 5 млн строк (`--progress 0` отключает);
- индексы строятся **после** данных; прерванное построение добивается
  `load_sqlite.py --db <файл> --only-indexes` — без повторного чтения TSV;
- сверка `COUNT(*)` с `--expect`; расхождение → код возврата 1 и «ВНИМАНИЕ».

Несколько файлов журнала грузятся в одну базу: у строк разные `src`. Если файлов много
и они загружаются по очереди — второй и следующие запуски с `--keep`. Отдельная база
на файл тоже нормальный вариант.

CLI `sqlite3` не обязателен: запросы можно запускать из Python
(`python -c "import sqlite3; …"`) или любым клиентом SQLite — база обычная.

## Сколько это стоит

Замеры 18.11.2026, HDD, 32 ГБ RAM, Python 3.15, один поток (срез реального журнала):

| Объём | Разбор в TSV | Загрузка | 12 индексов | База |
|---|---|---|---|---|
| 64 МиБ, 585 503 записи | — | 2 с (241 тыс. строк/с) | 1 с | 156 МБ |
| 1 ГиБ, 9 306 617 записей | 112 с (9,2 МиБ/с) | 52 с (177 тыс. строк/с) | 82 с | 2,3 ГиБ (TSV 1,1 ГБ) |
| 21,5 ГБ, 198,3 млн записей | ≈40 мин | ≈18 мин | ≈30–70 мин | ≈48 ГиБ (готовая база проекта разбора) |

Разбор упирается в Python (9–19 МиБ/с), загрузка — в цикл на строках, индексы — в диск.
Оценка для 21,5 ГБ линейная; реальное построение индексов может занять больше из-за промахов
кэша на 200 млн строк — планируйте **2 часа** и **60–80 ГБ** свободного места
(TSV + база + временные файлы сортировки).

Проверка на 1 ГиБ: `COUNT(*)` совпал с числом маркеров (9 306 617), все рецепты
[`analysis.md`](analysis.md) выполнились, тяжёлые — за секунды: топ событий 7,6 с,
связка «сеанс → задание» 4,2 с, ошибки по тексту 1,8 с, `COUNT(DISTINCT sess)` 0,01 с.

## Запросы

```sql
-- сколько записей и за какой период
SELECT COUNT(*), MIN(ts), MAX(ts), COUNT(DISTINCT src), COUNT(DISTINCT sess) FROM events;

-- топ событий
SELECT d.name, COUNT(*) n FROM events e JOIN dict_event d ON d.code = e.ev
GROUP BY e.ev, d.name ORDER BY n DESC LIMIT 20;

-- ошибки по тексту
SELECT substr(comment, 1, 120) AS msg, COUNT(*) n FROM events
WHERE sev IN ('E','W') AND comment <> '' GROUP BY msg ORDER BY n DESC LIMIT 20;

-- длительность транзакции: пара (время, номер) внутри сеанса
SELECT b.sess, b.tx_time, b.ts AS begin_ts, c.ts AS commit_ts
FROM events b JOIN events c
  ON c.tx_time = b.tx_time AND c.tx_num = b.tx_num AND c.sess = b.sess
 AND c.ev = (SELECT code FROM dict_event WHERE name = '_$Transaction$_.Commit')
WHERE b.ev = (SELECT code FROM dict_event WHERE name = '_$Transaction$_.Begin')
LIMIT 20;

-- к какой записи вернуться: src + off
SELECT src, off, ts, comment FROM events
WHERE sev = 'E' ORDER BY id DESC LIMIT 1;
```

Остальные рецепты (разрезы по заданиям, знаменатель, ловушка фильтра 1С) — в
[`analysis.md`](analysis.md); они используют те же `dict_*` и поля схемы.

Оригинал записи по `src` + `off`:

```bash
python read_record.py --input <logdir>/<src> --offset <off>
```

`<logdir>` — каталог `1Cv8Log` (см. [`format.md`](format.md)); `src` — имя файла.

## Грабли

| Симптом | Причина | Решение |
|---|---|---|
| «строка N: 1 колонка вместо 17» | TSV пересохранён в Excel / с другим разделителем | выгружайте заново `--format tsv`, не открывайте TSV в Excel |
| первое поле не число | BOM в TSV | `parse_lgp.py` пишет TSV без BOM; BOM бывает только у CSV |
| загрузка в разы медленнее | индексы уже есть на момент вставки | сначала данные, потом индексы (так и делает скрипт) |
| после сбоя база битая | `journal_mode=OFF` во время записи | для сборки это допустимо; для рабочей базы верните `PRAGMA journal_mode=WAL` |
| дубли строк после `--keep` | повторная загрузка того же TSV | сверяйте `COUNT(*)` с `--expect`; ищите дубль по `src` + `off` |
| `database is locked` | второй процесс пишет в ту же базу | один писатель: загрузка и запросы — по очереди |
| запрос по `data` идёт минуты | нет индекса по `TEXT` | `CREATE INDEX ix_data ON events(data)` или искать по `comment` |

## Проверка

```bash
python load_sqlite.py --tsv events.tsv --db eventlog.sqlite --expect <строк>
```

- итог «строк N» равен `--expect` и числу записей из `parse_lgp.py` («учтено» для полного
  файла, «разобрано» для среза с `--limit`);
- `COUNT(DISTINCT src)` равно числу загруженных файлов;
- `SELECT src, off FROM events LIMIT 5` → `read_record.py` по этим значениям печатает
  записи с теми же датами (проверено 18.11.2026: 5 из 5);
- при сомнениях — `PRAGMA quick_check` (на 200 млн строк может идти минуты).
