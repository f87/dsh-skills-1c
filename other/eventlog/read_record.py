#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Чтение оригинала записи журнала по смещению из базы.

В таблицу событий кладётся смещение `{` записи (поле off) и имя файла (src).
По ним этот скрипт достаёт запись целиком, включая комментарий со стеком,
который в таблицу не помещается. Смещение проверяется: если байт по нему не
начало записи, скрипт скажет об этом, а не напечатает мусор.

Примеры:
  python read_record.py --input 20260101000000.lgp --offset 104793
  python read_record.py --input <logdir>/20260101000000.lgp --offset 104793 --max 200000

Коды возврата: 0 — успех, 1 — запись не дочитана (мал --max), 2 — вход не тот.
"""
import argparse
import os
import sys

DEFAULT_MAX = 1 << 20          # 1 МиБ: запись с длинным стеком бывает в десятки КБ


def read_record(path, offset, limit=DEFAULT_MAX):
    """Возвращает (запись, дочитана_ли). offset — байт `{` (допустим и `\\n` перед ним)."""
    with open(path, "rb") as f:
        f.seek(offset)
        buf = f.read(limit)
    i = 1 if buf[:1] == b"\n" else 0          # смещение на перевод строки перед '{'
    if buf[i:i + 1] != b"{":
        raise ValueError("по этому смещению нет начала записи (ожидался '{')")
    depth, inq, n = 0, False, len(buf)
    start = i
    while i < n:
        c = buf[i]
        if inq:
            if c == 0x22:
                if i + 1 < n and buf[i + 1] == 0x22:
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
            if depth == 0:
                return buf[start:i + 1], True
        i += 1
    return buf[start:], False


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="Запись журнала по смещению")
    ap.add_argument("--input", required=True, help="файл .lgp (из поля src)")
    ap.add_argument("--offset", type=int, required=True, help="смещение из поля off")
    ap.add_argument("--max", type=int, default=DEFAULT_MAX,
                    help=f"максимум байт на чтение (по умолчанию {DEFAULT_MAX})")
    a = ap.parse_args()

    if not os.path.exists(a.input):
        print(f"файл не найден: {a.input}", file=sys.stderr)
        sys.exit(2)
    size = os.path.getsize(a.input)
    if a.offset < 0 or a.offset >= size:
        print(f"смещение {a.offset} вне файла (размер {size})", file=sys.stderr)
        sys.exit(2)
    if a.max < 16:
        print("--max меньше 16 байт не имеет смысла", file=sys.stderr)
        sys.exit(2)

    try:
        rec, complete = read_record(a.input, a.offset, a.max)
    except ValueError as e:
        print(f"{e} (смещение {a.offset}, файл {a.input}); "
              f"off берётся из базы и относится только к своему src", file=sys.stderr)
        sys.exit(2)

    sys.stdout.write(rec.decode("utf-8", "replace"))
    if not rec.endswith(b"\n"):
        sys.stdout.write("\n")
    if not complete:
        print(f"запись не дочитана: увеличьте --max (сейчас {a.max})", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
