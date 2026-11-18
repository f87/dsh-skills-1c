#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Парсер справочника описаний журнала регистрации 1С (.lgf).

Формат тот же 1CV8LOG(ver 2.0), записи вида:
  {код, значение, номер}
  {код, GUID, значение, номер}

Выход: JSON (для скриптов), SQL для SQLite или справочники прямо в файл базы.
Записи в .lgf разделены `,\\r\\n` и лежат по одной в строке, поэтому режем по балансу
скобок, а не по переводу строки.

Примеры:
  python parse_lgf.py --input 1Cv8.lgf
  python parse_lgf.py --input 1Cv8.lgf --out lgf.json
  python parse_lgf.py --input 1Cv8.lgf --sql dict.sql
  python parse_lgf.py --input 1Cv8.lgf --sqlite eventlog.sqlite   # сразу в базу

Коды возврата: 0 — успех, 1 — часть записей не разобрана, 2 — вход не тот.
Только стандартная библиотека.
"""
import argparse
import json
import sys

NAMES = {
    1: "users", 2: "computers", 3: "apps", 4: "events",
    5: "metadata", 6: "servers", 7: "ports_main", 8: "ports_aux", 9: "data_areas",
}

# какие массивы превращаются в таблицы-справочники и как они называются
SQL_TABLES = [
    ("dict_user", "users"),
    ("dict_comp", "computers"),
    ("dict_app", "apps"),
    ("dict_event", "events"),
    ("dict_meta", "metadata"),
]

MARK = b"1CV8LOG(ver 2.0)"


def split_records(data):
    recs, depth, inq, start = [], 0, False, -1
    i, n = 0, len(data)
    while i < n:
        c = data[i]
        if inq:
            if c == 0x22:
                if i + 1 < n and data[i + 1] == 0x22:
                    i += 2
                    continue
                inq = False
            i += 1
            continue
        if c == 0x22:
            inq = True
        elif c == 0x7B:
            if depth == 0:
                start = i
            depth += 1
        elif c == 0x7D:
            depth -= 1
            if depth == 0 and start >= 0:
                recs.append(data[start:i + 1])
                start = -1
        i += 1
    return recs


def fields(rec, limit=8):
    toks, i, n, depth, inq, start = [], 0, len(rec), 0, False, 1
    while i < n:
        c = rec[i]
        if inq:
            if c == 0x22:
                if i + 1 < n and rec[i + 1] == 0x22:
                    i += 2
                    continue
                inq = False
            i += 1
            continue
        if c == 0x22:
            inq = True
        elif c == 0x7B:
            depth += 1
        elif c == 0x7D:
            depth -= 1
        elif c == 0x2C and depth == 1:
            toks.append(rec[start:i])
            if len(toks) >= limit:
                return toks
            start = i + 1
        i += 1
    toks.append(rec[start:])
    toks = [t.strip() for t in toks]
    if toks and toks[-1].endswith(b"}"):
        toks[-1] = toks[-1][:-1].strip()
    return toks


def unquote(b):
    t = b.strip()
    if len(t) >= 2 and t[:1] == b'"' and t[-1:] == b'"':
        t = t[1:-1].replace(b'""', b'"')
    return t.decode("utf-8", "replace").replace("\r", "").replace("\n", "")


def esc(s):
    return s.replace("'", "''")            # в SQLite обратный слэш — обычный символ


def to_sql(d, path, name_len=255):
    """SQL-файл со справочниками для SQLite (можно скормить sqlite3 или загрузить самим)."""
    lines = ["-- справочники журнала регистрации (parse_lgf.py, SQLite);", ""]
    for table, key in SQL_TABLES:
        rows = sorted(d[key].items(), key=lambda kv: int(kv[0]))
        lines.append(f"DROP TABLE IF EXISTS {table};")
        lines.append(f"CREATE TABLE {table} ("
                     f"code INTEGER PRIMARY KEY, name TEXT NOT NULL);")
        if rows:
            vals = ",\n  ".join(f"({int(k)}, '{esc(v['name'])}')" for k, v in rows)
            lines.append(f"INSERT INTO {table}(code, name) VALUES\n  {vals};")
        lines.append("")
    text = "\n".join(lines)
    if path:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
        print(f"SQL      : {path} (SQLite)")
    else:
        print(text)


def to_sqlite(d, db):
    """Кладёт справочники прямо в файл SQLite (таблицы dict_*)."""
    import sqlite3
    con = sqlite3.connect(db)
    cur = con.cursor()
    for table, key in SQL_TABLES:
        cur.execute(f"DROP TABLE IF EXISTS {table}")
        cur.execute(f"CREATE TABLE {table} (code INTEGER PRIMARY KEY, "
                    f"name TEXT NOT NULL)")
        rows = sorted(d[key].items(), key=lambda kv: int(kv[0]))
        cur.executemany(f"INSERT INTO {table}(code, name) VALUES (?, ?)",
                        [(int(k), v["name"]) for k, v in rows])
    con.commit()
    con.close()
    print(f"SQLITE   : {db} ({', '.join(t for t, _ in SQL_TABLES)})")


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="Парсер .lgf — справочника описаний журнала")
    ap.add_argument("--input", required=True, help="файл .lgf")
    ap.add_argument("--out", help="JSON для выгрузки")
    ap.add_argument("--sql", metavar="FILE", nargs="?", const="",
                    help="SQL со справочниками для SQLite (без значения — в stdout)")
    ap.add_argument("--sqlite", metavar="DB", help="положить справочники прямо в файл SQLite")
    a = ap.parse_args()

    try:
        with open(a.input, "rb") as f:
            data = f.read()
    except OSError as e:
        print(f"не удалось прочитать входной файл: {e}", file=sys.stderr)
        sys.exit(2)
    if MARK not in data[:64]:
        print(f"это не файл описаний: в начале нет {MARK.decode()!r}", file=sys.stderr)
        sys.exit(2)

    recs = split_records(data)
    d = {v: {} for v in NAMES.values()}
    other = {}
    skipped = 0

    for rec in recs:
        t = fields(rec)
        if len(t) < 3:
            skipped += 1
            continue
        try:
            code = int(t[0])
            if code in NAMES:
                if len(t) >= 4:
                    d[NAMES[code]][int(t[3])] = {"name": unquote(t[2]), "guid": unquote(t[1])}
                else:
                    d[NAMES[code]][int(t[2])] = {"name": unquote(t[1]), "guid": None}
            else:
                other[code] = other.get(code, 0) + 1
        except (ValueError, IndexError):
            skipped += 1

    print(f"файл     : {a.input}")
    print(f"записей  : {len(recs):,}")
    for k, v in d.items():
        print(f"  {k:>12}: {len(v):>6,}")
    if other:
        print(f"  служебные коды: {sorted(other)}")
    if skipped:
        print(f"  пропущено записей: {skipped}", file=sys.stderr)

    if not d["events"] and not d["users"]:
        print("похоже, это файл данных, а не описаний — проверьте входной файл", file=sys.stderr)
        sys.exit(2)

    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="\n") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        print(f"JSON     : {a.out}")

    if a.sql is not None:
        to_sql(d, a.sql)

    if a.sqlite:
        to_sqlite(d, a.sqlite)

    if skipped:
        sys.exit(1)


if __name__ == "__main__":
    main()
