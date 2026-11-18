#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Парсер журнала регистрации 1С (.lgp, формат 1CV8LOG ver 2.0).

Двухуровневый разбор:
  1) одна регулярка на всю запись (покрывает ~99,999 %);
  2) запасной разбор по скобкам для полей «Данные» с вложенностью 4+ уровней
     (принимает записи с 17 полями и больше — хвостовые поля не нужны).

Вывод: статистика и, по желанию, CSV (UTF-8 с BOM, разделитель ';' — открывается
двойным щелчком в русском Excel) или TSV (без заголовка, для load_sqlite.py).
В строке 17 колонок: 16 полей записи + `src` — имя файла-источника (смещение `off`
имеет смысл только вместе с ним).

Примеры:
  python parse_lgp.py --input 20260101000000.lgp
  python parse_lgp.py --input журнал.lgp --out events.csv
  python parse_lgp.py --input журнал.lgp --out events.tsv --format tsv
  python parse_lgp.py --input журнал.lgp --from 6100000000 --limit 67108864
  python parse_lgp.py --input журнал.lgp --from 104793 --limit 10000000
  python parse_lgp.py --input журнал.lgp --check          # независимая сверка счётчиков

`--from` можно указывать прямо по `off` записи из базы/CSV: парсер видит, что
смещение стоит на '{' + дате, и восстанавливает разделитель — запись не теряется.

Коды возврата: 0 — успех, 1 — были неразобранные записи, 2 — вход не тот.
Только стандартная библиотека.
"""
import argparse
import csv
import os
import re
import sys
import time

HEAD = re.compile(
    rb"\n\{\s*(\d{14}),\s*([A-Z]),\s*\{([0-9a-f]+),([0-9a-f]+)\},\s*"
    rb"(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*([A-Z]),\s*"
    rb'"((?:[^"]|"")*)"\s*,\s*(\d+)\s*,\s*'
    rb'(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*,\s*'
    rb'"((?:[^"]|"")*)"\s*,\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)'
)
REC = re.compile(rb"\n\{(\d{14}),")
REC_START = re.compile(rb"\{\d{14},")   # старт ровно на '{' (смещение записи)
TX = re.compile(rb"([0-9a-f]+),([0-9a-f]+)")
MARK = b"1CV8LOG(ver 2.0)"

# comment — поле 10: текст сообщения об ошибке. Без него «ошибки по тексту» не сгруппировать.
# src — имя файла: без него off неоднозначен, если журнал разбит на несколько .lgp.
COLUMNS = ["ts", "ev", "sev", "st", "usr", "comp", "app", "conn",
           "meta", "data", "comment", "sess", "tx_time", "tx_num", "tx_signed", "off",
           "src"]

COMMENT_MAX = 300


def slow_fields(b):
    """Поля записи по балансу скобок; b начинается с '{'."""
    toks, i, n, depth, inq, start = [], 0, len(b), 0, False, 1
    while i < n:
        c = b[i]
        if inq:
            if c == 0x22:
                if i + 1 < n and b[i + 1] == 0x22:
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
                toks.append(b[start:i])
                return toks
        elif c == 0x2C and depth == 1:
            toks.append(b[start:i])
            start = i + 1
        i += 1
    toks.append(b[start:])
    return toks


def signed32(v):
    v &= 0xFFFFFFFF
    return v - (1 << 32) if v >= (1 << 31) else v


def unesc_quotes(b):
    """Раскрывает экранирование кавычек `""` → `"` (быстрый путь: кавычек-ограничителей уже нет)."""
    return b.replace(b'""', b'"')


def unquote_field(b):
    """Снимает внешние кавычки поля и раскрывает `""` → `"` (медленный путь)."""
    t = b.strip()
    if len(t) >= 2 and t[:1] == b'"' and t[-1:] == b'"':
        t = t[1:-1]
    return t.replace(b'""', b'"')


def text(b, tsv=False, limit=None):
    """Байты поля в строку.

    tsv=False: переводы строк заменяются пробелом (для CSV и просмотра),
    tsv=True : экранируются как \\n / \\t / \\r и удваивается обратный слэш;
               load_sqlite.py раскрывает те же четыре последовательности обратно.

    limit применяется ДО экранирования, иначе CSV и TSV обрезали бы одно и то же
    значение в разных местах (экранирование удлиняет текст).
    """
    s = b.decode("utf-8", "replace")
    if not tsv:
        s = s.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    if limit and len(s) > limit:
        s = s[:limit]
    if tsv:
        s = (s.replace("\\", "\\\\").replace("\t", "\\t")
              .replace("\n", "\\n").replace("\r", "\\r"))
    return s


def parse_block(data, base, cut, sink, tsv):
    """Разбирает записи с началом в [0, cut) и отдаёт строки в sink."""
    rows = slow = bad = 0
    pos = [m.start() for m in REC.finditer(data)]
    for k, p in enumerate(pos):
        if p >= cut:
            break
        hm = HEAD.match(data, p)
        if hm:
            g = hm.groups()
            tx_num = int(g[3], 16)
            row = (int(g[0]), int(g[8]), g[9].decode("latin1"),
                   g[1].decode("latin1"), int(g[4]), int(g[5]), int(g[6]),
                   int(g[7]), int(g[11]), g[12], unesc_quotes(g[10]), int(g[17]),
                   int(g[2], 16), tx_num, signed32(tx_num), base + p + 1)
        else:
            end = pos[k + 1] if k + 1 < len(pos) else len(data)
            t = slow_fields(data[p + 1:end])
            if len(t) < 17:
                bad += 1
                continue
            txraw = t[2].strip()
            if txraw[:1] == b"{" and txraw[-1:] == b"}":
                txraw = txraw[1:-1]
            tx = TX.match(txraw)
            if not tx:
                bad += 1
                continue
            tx_num = int(tx.group(2), 16)
            row = (int(t[0]), int(t[7]), t[8].strip()[:1].decode("latin1"),
                   t[1].strip()[:1].decode("latin1"), int(t[3]), int(t[4]), int(t[5]),
                   int(t[6]), int(t[10]), t[11].strip(), unquote_field(t[9]), int(t[16]),
                   int(tx.group(1), 16), tx_num, signed32(tx_num), base + p + 1)
            slow += 1
        sink(row, tsv)
        rows += 1
    return rows, slow, bad


def last_marker(data):
    """Позиция последнего маркера (\\n + 14 цифр + ,) или -1, если его нет."""
    idx = data.rfind(b"\n{")
    n = len(data)
    while idx > 0 and not (idx + 16 <= n and data[idx + 2:idx + 16].isdigit()):
        idx = data.rfind(b"\n{", 0, idx)
    if idx == 0:
        return 0          # маркер в нулевой позиции: завершённых записей до него нет
    return idx if idx > 0 else -1


def check_input(path):
    try:
        with open(path, "rb") as f:
            head = f.read(64)
    except OSError as e:
        print(f"не удалось прочитать входной файл: {e}", file=sys.stderr)
        sys.exit(2)
    if MARK not in head:
        print(f"это не журнал регистрации: в начале файла нет {MARK.decode()!r}",
              file=sys.stderr)
        sys.exit(2)


def main():
    # русский текст в выводе не должен падать на консоли без кириллицы (cp1252/cp437)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="Парсер журнала регистрации 1С (.lgp)")
    ap.add_argument("--input", required=True, help="файл .lgp")
    ap.add_argument("--out", help="файл для выгрузки записей")
    ap.add_argument("--format", choices=("csv", "tsv"), default="csv",
                    help="csv — UTF-8 с BOM и ';' (Excel), tsv — для load_sqlite.py")
    ap.add_argument("--from", dest="start", type=int, default=0,
                    help="начальное смещение, байт (можно off записи)")
    ap.add_argument("--limit", type=int, default=0, help="сколько байт читать (0 = до конца)")
    ap.add_argument("--chunk", type=int, default=64 << 20, help="размер блока чтения")
    ap.add_argument("--check", action="store_true",
                    help="независимый пересчёт маркеров с перекрытием (медленнее)")
    a = ap.parse_args()

    if a.start < 0:
        print("--from не может быть отрицательным", file=sys.stderr)
        sys.exit(2)
    if a.chunk < 1:
        print("--chunk должен быть положительным", file=sys.stderr)
        sys.exit(2)

    check_input(a.input)
    size = os.path.getsize(a.input)
    if a.start > size:
        print(f"--from {a.start} за концом файла (размер {size})", file=sys.stderr)
        sys.exit(2)
    stop = size if not a.limit else min(size, a.start + a.limit)

    src = os.path.basename(a.input)
    tsv = a.format == "tsv"
    out = None
    if a.out:
        # CSV — с BOM и ';': иначе русский Excel даёт кракозябры и одну колонку.
        # TSV — строго UTF-8 без BOM: BOM уехал бы в первое поле при загрузке в SQLite.
        out = open(a.out, "w", newline="", encoding="utf-8" if tsv else "utf-8-sig")
        if tsv:
            def sink(row, is_tsv):
                out.write("\t".join(
                    text(x, True, COMMENT_MAX if i == 10 else None) if isinstance(x, bytes)
                    else str(x) for i, x in enumerate(row + (src,))) + "\n")
        else:
            wr = csv.writer(out, delimiter=";", lineterminator="\n")
            wr.writerow(COLUMNS)

            def sink(row, is_tsv):
                wr.writerow([text(x, False, COMMENT_MAX if i == 10 else None)
                             if isinstance(x, bytes) else x
                             for i, x in enumerate(row + (src,))])
    else:
        def sink(row, is_tsv):
            pass

    st = {"rows": 0, "slow": 0, "bad": 0, "markers": 0, "ctrl": 0}

    # старт ровно на '{' записи? Решаем заранее по 17 байтам: при --chunk < 17
    # в первом блоке маркер ещё не виден, а решение нужно до разбора.
    start_at_record = False
    if a.start:
        with open(a.input, "rb") as f0:
            f0.seek(a.start)
            start_at_record = bool(REC_START.match(f0.read(17)))

    t0 = time.time()
    processed = a.start
    ctrl_tail = b""

    with open(a.input, "rb") as f:
        f.seek(a.start)
        carry, carry_base = b"", a.start
        while processed < stop:
            chunk = f.read(min(a.chunk, stop - processed))
            if not chunk:
                break
            data = carry + chunk
            base = carry_base
            processed += len(chunk)

            if start_at_record and not carry:
                # старт ровно на '{' записи (например, сохранённый off):
                # восстанавливаем разделитель, иначе запись выпадет из разбора.
                # Признак проверен пробой 17 байт до цикла — иначе при --chunk < 17
                # он не виден в первом блоке.
                data = b"\n" + data
                base -= 1
                start_at_record = False

            if a.check:
                # маркер — это \n{ + 14 цифр + ',' = 17 байт, поэтому перекрытия
                # в 16 байт достаточно, чтобы он всегда дочитался в одном из блоков.
                # Считаем те, что закончились в этом блоке (конец матча правее хвоста).
                for m in REC.finditer(ctrl_tail + chunk):
                    if m.end() > len(ctrl_tail):
                        st["ctrl"] += 1
                ctrl_tail = (ctrl_tail + chunk)[-16:]

            cut = last_marker(data)
            if cut > 0:
                r, s, b = parse_block(data, base, cut, sink, tsv)
                st["rows"] += r
                st["slow"] += s
                st["bad"] += b
                st["markers"] += r + b          # маркеры в разобранной части data[:cut]
                carry, carry_base = data[cut:], base + cut
            else:
                carry, carry_base = data, base
            del data, chunk

    if carry:
        # маркер хвоста считаем всегда: при --limit запись не дочитана, но маркер в файле есть
        st["markers"] += len(REC.findall(carry))
        if carry.rstrip().endswith(b"}"):
            r, s, b = parse_block(carry, carry_base, len(carry), sink, tsv)
            st["rows"] += r
            st["slow"] += s
            st["bad"] += b
        elif a.limit:
            print("последняя запись среза не дочитана: она начинается до границы --limit "
                  "и кончается после — увеличьте --limit", file=sys.stderr)
        else:
            print("последняя запись обрезана концом файла — пропущена", file=sys.stderr)

    if out:
        out.close()

    el = time.time() - t0
    print(f"файл             : {a.input}")
    print(f"источник (src)   : {src}")
    print(f"прочитано        : {processed - a.start:,} байт за {el:.1f} с "
          f"({(processed - a.start) / 1024**2 / max(el, 1e-9):.1f} МиБ/с)")
    print(f"маркеров (учтено): {st['markers']:,}")
    if a.check:
        print(f"маркеров (контроль, независимый пересчёт): {st['ctrl']:,}")
        if st["ctrl"] != st["markers"]:
            print("расхождение счётчиков: проверьте --chunk и целостность файла",
                  file=sys.stderr)
    print(f"разобрано        : {st['rows']:,}  (медленным путём {st['slow']:,}, "
          f"не разобрано {st['bad']:,})")
    if a.out:
        print(f"выгрузка         : {a.out} ({a.format}, {len(COLUMNS)} колонок)")

    if st["rows"] == 0:
        if st["markers"]:
            print("записи в файле есть, но ни одна не разобрана — проверьте формат",
                  file=sys.stderr)
        else:
            print("в файле не найдено ни одной записи — проверьте вход и смещение",
                  file=sys.stderr)
        sys.exit(2)
    if st["bad"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
