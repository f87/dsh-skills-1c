#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Загрузка выгрузки parse_lgp.py в SQLite — без сервера и без внешних зависимостей.

Порядок: таблица без индексов -> INSERT пачками в одной транзакции -> индексы ->
ANALYZE -> сверка. Одна запись журнала = одна строка, плюс `src` (имя файла)
и `day`/`hour`, посчитанные из `ts`.

Годится и для журналов в десятки гигабайт: 198 млн строк — это ~48 ГиБ базы
и около часа построения индексов (см. sqlite.md).

Примеры:
  python parse_lgp.py --input 20260101000000.lgp --out events.tsv --format tsv
  python load_sqlite.py --tsv events.tsv --db eventlog.sqlite --expect <маркеров>
  python load_sqlite.py --tsv events.tsv --db eventlog.sqlite --skip-indexes
  python load_sqlite.py --db eventlog.sqlite --only-indexes   # достроить индексы

Коды возврата: 0 — успех, 1 — число строк не совпало с --expect, 2 — вход не тот.
Только стандартная библиотека (sqlite3 входит в Python).
"""
import argparse
import os
import sqlite3
import sys
import time

COLS = ["ts", "day", "hour", "ev", "sev", "st", "usr", "comp", "app", "conn",
        "meta", "data", "comment", "sess", "tx_time", "tx_num", "tx_signed", "off",
        "src"]

DDL = """
CREATE TABLE IF NOT EXISTS {t} (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER NOT NULL,
  day       INTEGER NOT NULL,
  hour      INTEGER NOT NULL,
  ev        INTEGER NOT NULL,
  sev       TEXT    NOT NULL,
  st        TEXT    NOT NULL,
  usr       INTEGER NOT NULL,
  comp      INTEGER NOT NULL,
  app       INTEGER NOT NULL,
  conn      INTEGER NOT NULL,
  meta      INTEGER NOT NULL,
  data      TEXT    NULL,
  comment   TEXT    NULL,
  sess      INTEGER NOT NULL,
  tx_time   INTEGER NULL,
  tx_num    INTEGER NULL,
  tx_signed INTEGER NULL,
  off       INTEGER NOT NULL,
  src       TEXT    NOT NULL
)
"""

INDEXES = [
    ("ix_ts", "ts"),
    ("ix_day", "day, hour"),
    ("ix_ev", "ev"),
    ("ix_usr", "usr"),
    ("ix_app", "app"),
    ("ix_meta", "meta"),
    ("ix_sess", "sess"),
    ("ix_tx", "tx_signed"),
    ("ix_txp", "tx_time, tx_num"),
    ("ix_ev_usr", "ev, usr"),
    ("ix_ev_app", "ev, app"),
    ("ix_src_off", "src, off"),
]

FIELDS = 17          # колонок в TSV parse_lgp.py


def unesc(s):
    """Обратное к parse_lgp.text(tsv=True): \\\\, \\t, \\n, \\r."""
    if "\\" not in s:
        return s
    out, i, n = [], 0, len(s)
    while i < n:
        j = s.find("\\", i)
        if j < 0:
            out.append(s[i:])
            break
        out.append(s[i:j])
        c = s[j + 1:j + 2]
        out.append({"t": "\t", "n": "\n", "r": "\r", "\\": "\\"}.get(c, c))
        i = j + 2
    return "".join(out)


def rows(path):
    """Строки TSV -> кортежи в порядке COLS."""
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
        for ln, line in enumerate(f, 1):
            line = line.rstrip("\r\n")
            if not line:
                continue
            p = line.split("\t")
            if len(p) != FIELDS:
                raise SystemExit(f"строка {ln}: {len(p)} колонок вместо {FIELDS} — "
                                 f"это не выгрузка parse_lgp.py")
            ts = int(p[0])
            yield (ts, ts // 1000000, (ts // 10000) % 100,
                   int(p[1]), p[2], p[3],
                   int(p[4]), int(p[5]), int(p[6]), int(p[7]), int(p[8]),
                   unesc(p[9]), unesc(p[10]), int(p[11]),
                   int(p[12]), int(p[13]), int(p[14]), int(p[15]), unesc(p[16]))


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="Загрузка выгрузки журнала в SQLite")
    ap.add_argument("--tsv", help="файл TSV из parse_lgp.py --format tsv")
    ap.add_argument("--db", required=True, help="файл базы SQLite (создаётся)")
    ap.add_argument("--table", default="events")
    ap.add_argument("--batch", type=int, default=50000, help="размер пачки INSERT")
    ap.add_argument("--cache-mb", type=int, default=512, help="кэш страниц SQLite, МБ")
    ap.add_argument("--progress", type=int, default=5000000,
                    help="печатать прогресс каждые N строк (0 — не печатать)")
    ap.add_argument("--skip-indexes", action="store_true")
    ap.add_argument("--keep", action="store_true", help="не удалять существующую таблицу")
    ap.add_argument("--only-indexes", action="store_true",
                    help="только достроить индексы в готовой базе (данные не читаются)")
    ap.add_argument("--expect", type=int, help="ожидаемое число строк (маркеров из parse_lgp)")
    a = ap.parse_args()

    if not a.only_indexes and not a.tsv:
        print("нужен --tsv (или --only-indexes для готовой базы)", file=sys.stderr)
        sys.exit(2)
    if a.tsv and not os.path.exists(a.tsv):
        print(f"файл не найден: {a.tsv}", file=sys.stderr)
        sys.exit(2)
    if not a.table.replace("_", "").isalnum():
        print(f"недопустимое имя таблицы: {a.table!r}", file=sys.stderr)
        sys.exit(2)
    if a.only_indexes and not os.path.exists(a.db):
        print(f"база не найдена: {a.db}", file=sys.stderr)
        sys.exit(2)

    con = sqlite3.connect(a.db)
    # сборка с нуля: журнал не нужен, скорость важнее. Дозагрузка (--keep) — в WAL,
    # чтобы сбой не оставил базу в промежуточном состоянии.
    con.execute(f"PRAGMA journal_mode={'OFF' if not a.keep and not a.only_indexes else 'WAL'}")
    con.execute(f"PRAGMA synchronous={'OFF' if not a.keep and not a.only_indexes else 'NORMAL'}")
    con.execute("PRAGMA temp_store=MEMORY")
    con.execute(f"PRAGMA cache_size={-abs(a.cache_mb) * 1024}")   # кэш страниц, КиБ
    con.execute("PRAGMA mmap_size=268435456")                     # 256 МБ mmap
    cur = con.cursor()
    t0 = time.time()

    n = 0
    if not a.only_indexes:
        if not a.keep:
            cur.execute(f"DROP TABLE IF EXISTS {a.table}")
        cur.execute(DDL.format(t=a.table))
        con.commit()
        print(f"[{time.time()-t0:6.0f}c] таблица {a.table} готова")

        ins = (f"INSERT INTO {a.table}({', '.join(COLS)}) "
               f"VALUES ({', '.join('?' * len(COLS))})")
        batch, t1 = [], time.time()
        try:
            for row in rows(a.tsv):
                batch.append(row)
                if len(batch) >= a.batch:
                    cur.executemany(ins, batch)
                    n += len(batch)
                    batch.clear()
                    if a.progress and n % a.progress < a.batch:
                        el = time.time() - t1
                        print(f"[{time.time()-t0:6.0f}c] загружено {n:,} строк "
                              f"({n / max(el, 1e-9):,.0f} строк/с)", file=sys.stderr)
        except SystemExit as e:
            print(e, file=sys.stderr)
            sys.exit(2)
        if batch:
            cur.executemany(ins, batch)
            n += len(batch)
        con.commit()
        el = time.time() - t0
        print(f"[{el:6.0f}c] загружено строк: {n:,} "
              f"({n / max(el, 1e-9):,.0f} строк/с)")
    else:
        print(f"[{time.time()-t0:6.0f}c] индексы для готовой базы {a.db}")

    if not a.skip_indexes:
        for name, cols in INDEXES:
            ti = time.time()
            cur.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {a.table}({cols})")
            con.commit()
            print(f"[{time.time()-t0:6.0f}c] индекс {name:11} за {time.time()-ti:5.0f}c")
        cur.execute(f"ANALYZE {a.table}")
        con.commit()
        cur.execute("PRAGMA optimize")
        con.commit()

    cur.execute(f"SELECT COUNT(*), MIN(ts), MAX(ts), COUNT(DISTINCT src), "
                f"COUNT(DISTINCT sess) FROM {a.table}")
    cnt, mn, mx, files, sess = cur.fetchone()
    size = os.path.getsize(a.db) / 1024 ** 3
    print(f"итог: строк {cnt:,}, период {mn} .. {mx}, файлов {files}, "
          f"сеансов {sess:,}, база {size:.1f} ГиБ")

    rc = 0
    if a.expect is not None and cnt != a.expect:
        print(f"ВНИМАНИЕ: строк {cnt:,} против ожидаемых {a.expect:,} "
              f"(разница {cnt - a.expect:+,})", file=sys.stderr)
        rc = 1
    con.close()
    sys.exit(rc)


if __name__ == "__main__":
    main()
