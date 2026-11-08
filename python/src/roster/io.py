# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Reading registers: a folder of CSV files, or the tables of a report package.

Values must already be taxonomy codes (for example eba_GA:LU). To convert a
workbook with labels, use the command line tool: `roster import`.
"""

import csv
import io
import os
import re
import zipfile

from .taxonomy import TEMPLATES

MAX_FILE = 64 * 1024 * 1024
MAX_ENTRIES = 2000
MAX_TOTAL = 256 * 1024 * 1024
MAX_RATIO = 1000
HEADER = re.compile(r"\A(?:(B[_ .]?[0-9]{2}[_ .][0-9]{2})[_ .])?c?([0-9]{4})\Z", re.IGNORECASE)
TEMPLATE_NAME = re.compile(r"\A\s*t?B[_ .-]?([0-9]{2})[_ .-]?([0-9]{2})\s*\Z", re.IGNORECASE)
NEUTRALISED = re.compile("\\A'[\\s\u3000]*[=+\\-@\\t\\r\\n\uff1d\uff0b\uff0d\uff20]")


class RegisterReadError(ValueError):
    """The input cannot be read safely."""


def _template_of(filename):
    m = TEMPLATE_NAME.match(re.sub(r"\.csv\Z", "", filename, flags=re.IGNORECASE))
    return "B_%s.%s" % (m.group(1), m.group(2)) if m else None


def _parse_table(code, text, special_values):
    template = TEMPLATES[code]
    codes = {c["code"] for c in template["columns"]}
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    try:
        rows = list(reader)
    except csv.Error as e:
        raise RegisterReadError("%s: malformed CSV (%s)" % (code, e)) from None
    if not rows:
        return []
    if len(rows) == 1 and all(f == "" for f in rows[0]):
        return []
    header = []
    for h in rows[0]:
        if h.strip() == "":
            if special_values:
                # EBA filing rules, xBRL-CSV reports extra rule 2: no empty header cell.
                raise RegisterReadError("%s: empty cell in the header row" % code)
            header.append(None)
            continue
        m = HEADER.match(h.strip())
        col = "c" + m.group(2) if m else None
        if col is None or col not in codes:
            raise RegisterReadError("%s: header %r is not a column of the template" % (code, h[:40]))
        if col in header:
            raise RegisterReadError("%s: column %s appears twice" % (code, col))
        header.append(col)
    out = []
    for r in rows[1:]:
        if all(f == "" for f in r):
            continue
        if special_values and len(r) != len(header):
            # EBA filing rules, xBRL-CSV reports extra rule 3: as many fields as the header.
            raise RegisterReadError("%s: a row has %d fields, the header %d" % (code, len(r), len(header)))
        if len(r) > len(header) and any(f != "" for f in r[len(header):]):
            raise RegisterReadError("%s: a row has more fields than the header" % code)
        row = {}
        for col, value in zip(header, r):
            if col is None or value == "":
                continue
            if special_values:
                if value.startswith("##"):
                    value = value[1:]
                elif value.startswith("#"):
                    raise RegisterReadError("%s: special value %r not allowed" % (code, value[:20]))
            elif NEUTRALISED.match(value):
                value = value[1:]
            row[col] = value
        out.append(row)
    return out


def read_csv_folder(folder):
    """Read b_01.01.csv ... from a folder (no symbolic links followed). Returns {template: [rows]}."""
    register = {}
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if os.path.islink(path) or not os.path.isfile(path) or not name.lower().endswith(".csv"):
            continue
        code = _template_of(name)
        if code is None or code not in TEMPLATES:
            continue
        if os.path.getsize(path) > MAX_FILE:
            raise RegisterReadError("%s is larger than %d bytes" % (name, MAX_FILE))
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        except OSError:
            raise RegisterReadError("%s cannot be opened (or is a symbolic link)" % name) from None
        with os.fdopen(fd, "rb") as f:
            data = f.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            raise RegisterReadError("%s is larger than %d bytes" % (name, MAX_FILE))
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise RegisterReadError("%s is not UTF-8" % name) from None
        register[code] = _parse_table(code, text, special_values=False)
    return register


def read_report_package_tables(path):
    """Read the template tables of an xBRL-CSV report package (.zip), with zip bomb limits."""
    if os.path.islink(path) or os.path.getsize(path) > MAX_FILE * 4:
        raise RegisterReadError("package is a link or too large")
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        if len(infos) > MAX_ENTRIES:
            raise RegisterReadError("too many entries")
        total = 0
        names = set()
        for i in infos:
            n = i.filename
            if n in names or n.startswith("/") or "\\" in n or any(p in ("..", ".") for p in n.split("/")) or i.flag_bits & 0x1:
                raise RegisterReadError("unsafe or encrypted entry %r" % n[:60])
            names.add(n)
            total += i.file_size
            if i.compress_size and i.file_size / i.compress_size > MAX_RATIO:
                raise RegisterReadError("compression ratio too high")
        if total > MAX_TOTAL:
            raise RegisterReadError("package expands beyond the limit")
        register = {}
        for i in infos:
            parts = i.filename.split("/")
            if len(parts) != 3 or parts[1] != "reports" or not parts[2].endswith(".csv"):
                continue
            code = next((t["code"] for t in TEMPLATES.values() if t["file"] == parts[2]), None)
            if code is None:
                continue
            with z.open(i) as f:
                data = f.read(i.file_size + 1)
            if len(data) != i.file_size:
                raise RegisterReadError("entry size differs from its header")
            try:
                text = data.decode("utf-8-sig")
            except UnicodeDecodeError:
                raise RegisterReadError("%s is not UTF-8" % parts[2]) from None
            register[code] = _parse_table(code, text, special_values=True)
        return register
