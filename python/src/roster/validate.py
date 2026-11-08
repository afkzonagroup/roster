# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Validation of a register of information (port of src/validate/register.ts)."""

import json
import re
from dataclasses import dataclass
from typing import Optional

from . import dpmxl
from .identifiers import check_euid, check_lei
from .taxonomy import TAXONOMY, allowed_values

NOT_XBRL_CSV = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udfff]")
C1 = re.compile("[\x7f-\x9f]")
INVISIBLE = re.compile("[\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]")
FORMULA = re.compile("\\A[\\s\u3000]*[=+\\-@\uff1d\uff0b\uff0d\uff20]")
PLAIN_NUMBER = re.compile(r"\A-?[0-9]+(\.[0-9]+)?\Z")
DATE = re.compile(r"\A([0-9]{4})-([0-9]{2})-([0-9]{2})\Z")
INTEGER = re.compile(r"\A[+-]?[0-9]+\Z")
DECIMAL = re.compile(r"\A[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)\Z")
FUNCTION_ID = re.compile(r"\AF[0-9]+\Z")
TYPE_RULE = {"d": "esa.330", "i": "esa.331", "m": "esa.305", "t": "esa.333", "e": "esa.503"}


@dataclass(frozen=True)
class Finding:
    """One problem: rule id, severity, template, 1-based row, column, message."""

    rule: str
    severity: str
    template: Optional[str]
    row: Optional[int]
    column: Optional[str]
    message: str

    def key(self):
        """The form used by the shared test vectors."""
        return "%s|%s|%s|%s|%s" % (self.severity, self.rule, self.template or "", "" if self.row is None else self.row, self.column or "")


def is_iso_date(v):
    m = DATE.match(v)
    if not m:
        return False
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if mo < 1 or mo > 12 or d < 1:
        return False
    leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
    return d <= days


def canonical_integer(v):
    if not INTEGER.match(v):
        return v
    neg = v.startswith("-")
    digits = re.sub(r"\A0+(?=[0-9])", "", re.sub(r"\A[+-]", "", v))
    return "-" + digits if neg and digits != "0" else digits


def _has_c1_or_invisible(v):
    return bool(C1.search(v) or INVISIBLE.search(v))


def _has_lone_surrogate(v):
    # Python strings decoded from UTF-8 cannot hold lone surrogates unless built so.
    return bool(re.search("[\ud800-\udfff]", v))


def _column_name(c):
    its = c.get("its")
    return "%s %s" % (its["code"], its["name"]) if its else "%s %s" % (c["code"], c["label"])


def _col(template, code):
    for c in template["columns"]:
        if c["code"] == code:
            return c
    return None


_PARSED = {}


def _rule_ast(rule):
    if rule["code"] not in _PARSED:
        ast, reason = dpmxl.parse(rule["expression"])
        _PARSED[rule["code"]] = ast if ast is not None else reason
    return _PARSED[rule["code"]]


def validate_register(register, reporting=False, reference_date=None, include_inactive_rules=False, max_findings=10000):
    """Validate a register: a dict mapping template codes (B_01.01 ...) to lists of row dicts.

    Row dicts map column codes (c0010 ...) to strings; missing or empty means not reported.
    Returns (findings, rules_run, not_evaluated).
    """
    findings = []

    def add(rule, severity, message, template, row=None, column=None):
        if len(findings) < max_findings:
            findings.append(Finding(rule, severity, template["code"], row, column["code"] if column else None, message))

    primary = {}
    for template in TAXONOMY["templates"]:
        rows = register.get(template["code"], [])
        seen = {}
        index = set()
        for i, row in enumerate(rows):
            n = i + 1
            for column in template["columns"]:
                value = row.get(column["code"], "")
                if value == "":
                    status = (column.get("its") or {}).get("status")
                    if column["key"]:
                        add("esa.805", "error", "%s: key column is empty." % _column_name(column), template, n, column)
                    elif status == "mandatory" or (status == "reporting" and reporting):
                        add("its.mandatory", "warning", "%s: mandatory in the ITS but empty." % _column_name(column), template, n, column)
                    continue
                _check_cell(add, template, column, value, n)
            for code in row:
                if _col(template, code) is None:
                    add("esa.801", "error", "Column %s is not defined for %s." % (code, template["code"]), template, n)
            _check_pairs(add, template, row, n)
            key = _key(template, row, template["primaryKey"])
            if key in seen:
                add("esa.806", "error", "Same key values as row %d." % seen[key], template, n)
            else:
                seen[key] = n
            index.add(key)
        primary[template["code"]] = index

    for template in TAXONOMY["templates"]:
        rows = register.get(template["code"], [])
        for ref in template["references"]:
            target = next((t for t in TAXONOMY["templates"] if t["code"] == ref["target"]), None)
            if target is None:
                continue
            for i, row in enumerate(rows):
                local = [row.get(c, "") for c in ref["columns"]]
                if all(v == "" for v in local):
                    continue
                typed = []
                for k, v in enumerate(local):
                    tc = _col(target, target["primaryKey"][k])
                    typed.append(canonical_integer(v) if tc is not None and tc["type"] == "i" else v)
                if json.dumps(typed) not in primary[ref["target"]]:
                    add("esa.807", "error", "%s has no matching row in %s (%s)." % ("+".join(ref["columns"]), ref["target"], ref["name"]), template, i + 1)

    rules_run, not_evaluated = [], []
    for rule in TAXONOMY["rules"]:
        if not rule["active"] and not include_inactive_rules:
            not_evaluated.append((rule["code"], "deactivated by the EBA"))
            continue
        if reference_date is not None and (
            (rule["fromReferenceDate"] is not None and reference_date < rule["fromReferenceDate"])
            or (rule["toReferenceDate"] is not None and reference_date > rule["toReferenceDate"])
        ):
            not_evaluated.append((rule["code"], "does not apply to reference date " + reference_date))
            continue
        ast = _rule_ast(rule)
        if isinstance(ast, str):
            not_evaluated.append((rule["code"], ast))
            continue
        table = ast["table"] or (rule["tables"][0] if rule["tables"] else None)
        template = next((t for t in TAXONOMY["templates"] if t["code"] == table), None)
        reason = "table not found" if template is None else dpmxl.check_evaluable(ast, template)
        if reason is not None:
            not_evaluated.append((rule["code"], reason))
            continue
        rules_run.append(rule["code"])
        existence = rule["source"] == "existence"
        severity = "error" if rule["severity"] == "error" else "warning"
        for i, row in enumerate(register.get(template["code"], [])):
            for col in dpmxl.evaluate_rule(ast, template, row, existence):
                add(rule["code"], severity, "Official validation rule %s fails: %s" % (rule["code"], rule["expression"]), template, i + 1, _col(template, col) if col else None)
    for ext in TAXONOMY["externalChecks"]:
        not_evaluated.append((ext["code"], "needs an external database"))
    return findings, rules_run, not_evaluated


def _key(template, row, columns):
    out = []
    for c in columns:
        v = row.get(c, "")
        col = _col(template, c)
        out.append(canonical_integer(v) if col is not None and col["type"] == "i" else v)
    return json.dumps(out)


def _check_cell(add, template, column, value, n):
    name = _column_name(column)
    if NOT_XBRL_CSV.search(value) or _has_lone_surrogate(value):
        add("xbrl-csv.character", "error", "%s: control character not allowed by xBRL-CSV." % name, template, n, column)
        return
    if _has_c1_or_invisible(value):
        add("roster.suspicious-character", "warning", "%s: invisible, bidirectional or control character." % name, template, n, column)
    if value.startswith("#"):
        add("eba-fr.csv-special", "error", "%s: starts with #; not allowed by the EBA filing rules (xBRL-CSV extra rule 5)." % name, template, n, column)
    if value != value.strip(" \t\n\r\x0b\x0c\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"):
        add("roster.whitespace", "warning", "%s: leading or trailing spaces." % name, template, n, column)
    t = column["type"]
    if t == "s" and FORMULA.match(value) and not PLAIN_NUMBER.match(value):
        add("roster.formula-like", "warning", "%s: starts like a spreadsheet formula." % name, template, n, column)
    if t == "e":
        if value not in allowed_values(column):
            add("esa.503", "error", "%s: not in the closed list." % name, template, n, column)
    elif t == "d":
        if not is_iso_date(value):
            add(TYPE_RULE["d"], "error", "%s: not a date yyyy-mm-dd." % name, template, n, column)
    elif t == "i":
        if not INTEGER.match(value):
            add(TYPE_RULE["i"], "error", "%s: not an integer." % name, template, n, column)
        elif (column.get("its") or {}).get("type") == "Natural number" and value.startswith("-") and canonical_integer(value) != "0":
            add("its.natural-number", "error", "%s: natural number expected." % name, template, n, column)
    elif t == "m":
        if not DECIMAL.match(value):
            add(TYPE_RULE["m"], "error", "%s: not a number." % name, template, n, column)
    elif t == "t":
        if value != "true":
            add(TYPE_RULE["t"], "error", "%s: only true." % name, template, n, column)
    if column.get("maxLength") is not None and len(value) > column["maxLength"]:
        add("its.max-length", "error", "%s: longer than %d characters." % (name, column["maxLength"]), template, n, column)
    if column.get("lei") and check_lei(value) is not None and not (column.get("euid") and check_euid(value)):
        add("its.lei", "error", "%s: not a valid LEI." % name, template, n, column)
    if template["code"] == "B_06.01" and column["code"] == "c0010" and not FUNCTION_ID.match(value):
        add("its.function-identifier", "error", "%s: F followed by a natural number." % name, template, n, column)
    if template["code"] == "B_05.02" and column["code"] == "c0050" and INTEGER.match(value) and int(value) < 1:
        add("its.rank", "error", "%s: rank is 1 or more." % name, template, n, column)


def _check_pairs(add, template, row, n):
    for tc in template["columns"]:
        if tc.get("identifies") is None:
            continue
        kind = row.get(tc["code"])
        idc = _col(template, tc["identifies"])
        ident = row.get(idc["code"]) if idc else None
        if idc is None or kind is None or not ident:
            continue
        if kind == "eba_qCO:qx2000" and check_lei(ident) is not None:
            add("its.lei", "error", "%s: type of code is LEI but the value is not a valid LEI." % _column_name(idc), template, n, idc)
        elif kind == "eba_qCO:qx2002" and not check_euid(ident):
            add("its.euid", "warning", "%s: type of code is EUID but the value has no EUID structure." % _column_name(idc), template, n, idc)
