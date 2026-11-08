# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Parser and evaluator for the DPM-XL subset of the DORA validation rules.

A port of src/validate/dpmxl.ts and src/validate/evaluate.ts. Expressions
become small tuples; nothing is ever turned into executable code.
"""

import re

COL = re.compile(r"\Ac[0-9]{4}\Z")


class ParseError(Exception):
    pass


def _tokenize(src):
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if c == "{":
            depth, j = 0, i
            while j < n:
                if src[j] == "{":
                    depth += 1
                elif src[j] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            if j >= n:
                raise ParseError("unbalanced braces")
            inner = src[i + 1 : j].strip()
            if inner.startswith("["):
                members = [s.strip() for s in inner.split(",")]
                for m in members:
                    if not re.fullmatch(r"\[[A-Za-z_][\w.]*:[\w.]+\]", m):
                        raise ParseError("bad member set")
                out.append(("sym", "{set"))
                out.extend(("mem", m[1:-1]) for m in members)
                out.append(("sym", "set}"))
            else:
                out.append(("sel", inner))
            i = j + 1
            continue
        if c == "[":
            j = src.find("]", i)
            if j < 0:
                raise ParseError("unbalanced brackets")
            inner = src[i + 1 : j].strip()
            g = re.fullmatch(r"get\s+([A-Za-z0-9_]+)", inner)
            if g:
                out.append(("kw", "get:" + g.group(1)))
            elif re.fullmatch(r"[A-Za-z_][\w.]*:[\w.]+", inner):
                out.append(("mem", inner))
            else:
                raise ParseError("unsupported bracket")
            i = j + 1
            continue
        if c == '"':
            j = src.find('"', i + 1)
            if j < 0:
                raise ParseError("unterminated string")
            out.append(("str", src[i + 1 : j]))
            i = j + 1
            continue
        two = src[i : i + 2]
        if two in ("!=", ">=", "<="):
            out.append(("sym", two))
            i += 2
            continue
        if c in "()=<>,:":
            out.append(("sym", c))
            i += 1
            continue
        m = re.match(r"-?[0-9]+(\.[0-9]+)?", src[i:])
        if m:
            out.append(("num", float(m.group(0))))
            i += len(m.group(0))
            continue
        m = re.match(r"[A-Za-z_][A-Za-z0-9_]*", src[i:])
        if m:
            out.append(("kw", m.group(0).lower()))
            i += len(m.group(0))
            continue
        raise ParseError("unexpected character")
    return out


def _selection(text):
    table = None
    rest = text
    m = re.fullmatch(r"(tB_[0-9]{2}\.[0-9]{2})\s*,\s*(.+)", text)
    if m:
        table = m.group(1)[1:]
        rest = m.group(2).strip()
    if rest == "c*":
        return ("select", table, "*", None, None)
    r = re.fullmatch(r"c([0-9]{4})-([0-9]{4})", rest)
    if r:
        return ("select", table, (), ("c" + r.group(1), "c" + r.group(2)), None)
    lm = re.fullmatch(r"\((.+)\)", rest)
    cols = tuple(s.strip() for s in (lm.group(1).split(",") if lm else [rest]))
    for c in cols:
        if not COL.match(c):
            raise ParseError("unsupported selection")
    return ("select", table, cols, None, None)


class _Parser:
    def __init__(self, toks):
        self.t = toks
        self.i = 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def is_kw(self, v):
        p = self.peek()
        return p is not None and p[0] == "kw" and p[1] == v

    def is_sym(self, v):
        p = self.peek()
        return p is not None and p[0] == "sym" and p[1] == v

    def expect_sym(self, v):
        if not self.is_sym(v):
            raise ParseError("expected " + v)
        self.i += 1

    def expect_kw(self, v):
        if not self.is_kw(v):
            raise ParseError("expected " + v)
        self.i += 1

    def rule(self):
        table, default_zero = None, False
        if self.is_kw("with"):
            self.i += 1
            sel = self.peek()
            if sel is None or sel[0] != "sel":
                raise ParseError("expected scope")
            self.i += 1
            parts = [s.strip() for s in sel[1].split(",")]
            t = re.fullmatch(r"tB_([0-9]{2}\.[0-9]{2})", parts[0])
            if not t:
                raise ParseError("expected table")
            table = "B_" + t.group(1)
            for p in parts[1:]:
                m = re.fullmatch(r"(default|interval)\s*:\s*(\S+)", p)
                if not m:
                    raise ParseError("unsupported scope option")
                if m.group(1) == "default":
                    if m.group(2) == "0":
                        default_zero = True
                    elif m.group(2) != "null":
                        raise ParseError("unsupported default")
                elif m.group(2) != "false":
                    raise ParseError("unsupported interval")
            self.expect_sym(":")
        expr = self.or_()
        if self.i < len(self.t):
            raise ParseError("trailing input")
        return {"table": table, "default_zero": default_zero, "expr": expr}

    def or_(self):
        left = self.and_()
        while self.is_kw("or"):
            self.i += 1
            left = ("or", left, self.and_())
        return left

    def and_(self):
        left = self.cmp()
        while self.is_kw("and"):
            self.i += 1
            left = ("and", left, self.cmp())
        return left

    def cmp(self):
        left = self.unary()
        p = self.peek()
        if p is not None and p[0] == "sym" and p[1] in ("=", "!=", ">", ">=", "<", "<="):
            self.i += 1
            return ("cmp", p[1], left, self.unary())
        if self.is_kw("in"):
            self.i += 1
            return ("cmp", "in", left, self.unary())
        return left

    def unary(self):
        if self.is_kw("not"):
            self.i += 1
            return ("not", self.unary())
        return self.primary()

    def primary(self):
        p = self.peek()
        if p is None:
            raise ParseError("unexpected end")
        kind, v = p
        if kind == "sym" and v == "(":
            self.i += 1
            e = self.or_()
            self.expect_sym(")")
            return e
        if kind == "kw" and v == "if":
            self.i += 1
            cond = self.or_()
            self.expect_kw("then")
            then = self.or_()
            other = None
            if self.is_kw("else"):
                self.i += 1
                other = self.or_()
            self.expect_kw("endif")
            return ("if", cond, then, other)
        if kind == "kw" and v == "isnull":
            self.i += 1
            self.expect_sym("(")
            a = self.or_()
            self.expect_sym(")")
            return ("isnull", a)
        if kind == "kw" and v == "match":
            self.i += 1
            self.expect_sym("(")
            a = self.or_()
            self.expect_sym(",")
            pat = self.peek()
            if pat is None or pat[0] != "str":
                raise ParseError("expected pattern")
            self.i += 1
            self.expect_sym(")")
            return ("match", a, pat[1])
        if kind == "sel":
            self.i += 1
            sel = _selection(v)
            g = self.peek()
            if g is not None and g[0] == "kw" and g[1].startswith("get:"):
                self.i += 1
                sel = sel[:4] + (g[1][4:].upper(),)
            return sel
        if kind == "mem":
            self.i += 1
            return ("member", v)
        if kind == "sym" and v == "{set":
            self.i += 1
            names = []
            while self.peek() is not None and self.peek()[0] == "mem":
                names.append(self.peek()[1])
                self.i += 1
            self.expect_sym("set}")
            return ("members", tuple(names))
        if kind == "num":
            self.i += 1
            return ("number", v)
        if kind == "str":
            self.i += 1
            return ("string", v)
        raise ParseError("unexpected token")


def parse(expression):
    """Return (rule, None) or (None, reason)."""
    try:
        return _Parser(_tokenize(expression)).rule(), None
    except ParseError as e:
        return None, str(e)


def selection_columns(sel, template):
    _, _table, cols, rng, _get = sel
    non_key = [c["code"] for c in template["columns"] if not c["key"]]
    if cols == "*":
        return non_key
    if rng is not None:
        return [c["code"] for c in template["columns"] if rng[0] <= c["code"] <= rng[1]]
    return list(cols)


def _dim_column(template, dim):
    for c in template["columns"]:
        if c["key"] and c["dimension"] is not None and c["dimension"].split(":")[-1] == dim:
            return c["code"]
    return None


def _children(n):
    k = n[0]
    if k in ("not", "isnull"):
        return [n[1]]
    if k == "match":
        return [n[1]]
    if k in ("and", "or"):
        return [n[1], n[2]]
    if k == "cmp":
        return [n[2], n[3]]
    if k == "if":
        return [x for x in (n[1], n[2], n[3]) if x is not None]
    return []


def _walk(n):
    yield n
    for c in _children(n):
        yield from _walk(c)


def referenced_columns(expr, template):
    out = set()
    for n in _walk(expr):
        if n[0] == "select":
            out.update(selection_columns(n, template))
            if n[4] is not None:
                k = _dim_column(template, n[4])
                if k is not None:
                    out.add(k)
    return out


def check_evaluable(rule, template):
    problems = []
    codes = {c["code"] for c in template["columns"]}
    multi = 0
    for n in _walk(rule["expr"]):
        if n[0] != "select":
            continue
        if n[1] is not None and n[1] != template["code"]:
            problems.append("refers to another table")
        cols = selection_columns(n, template)
        if len(cols) != 1:
            multi += 1
        for c in cols:
            if c not in codes:
                problems.append("column %s is not in %s" % (c, template["code"]))
        if n[4] is not None and _dim_column(template, n[4]) is None:
            problems.append("dimension %s is not a key of %s" % (n[4], template["code"]))
    if multi > 1:
        problems.append("more than one multi-column selection")
    return "; ".join(problems) if problems else None


NUMBER = re.compile(r"\A[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)\Z")
NESTED_QUANTIFIER = re.compile(r"\([^)]*[+*}][^)]*\)[+*{?]")
SAFE_PATTERN = re.compile(r"\A[\w^$\[\]{}(),.|?*+\\-]{1,200}\Z")


def _num(x):
    return isinstance(x, float) and not isinstance(x, bool)


def _compare(op, a, b):
    if op == "in":
        if a is None or not isinstance(a, str) or not isinstance(b, tuple):
            return None
        return a in b
    if a is None or b is None or isinstance(a, tuple) or isinstance(b, tuple):
        return None
    x, y = a, b
    if isinstance(x, str) and _num(y) and NUMBER.match(x):
        x = float(x)
    if isinstance(y, str) and _num(x) and NUMBER.match(y):
        y = float(y)
    if isinstance(x, str) and isinstance(y, str) and NUMBER.match(x) and NUMBER.match(y) and op not in ("=", "!="):
        x, y = float(x), float(y)
    if type(x) is not type(y):
        return True if op == "!=" else (False if op == "=" else None)
    if op == "=":
        return x == y
    if op == "!=":
        return x != y
    if op == ">":
        return x > y
    if op == ">=":
        return x >= y
    if op == "<":
        return x < y
    if op == "<=":
        return x <= y
    return None


def _tri(v):
    return v if isinstance(v, bool) else None


def _eval(n, ctx):
    k = n[0]
    if k == "select":
        col = ctx["bound"].get(id(n)) or (selection_columns(n, ctx["template"]) or [""])[0]
        v = ctx["row"].get(col) or None
        if n[4] is None or v is None:
            return v
        kc = _dim_column(ctx["template"], n[4])
        return (ctx["row"].get(kc) or None) if kc else None
    if k == "member":
        return n[1]
    if k == "members":
        return n[1]
    if k in ("number", "string"):
        return n[1]
    if k == "not":
        v = _tri(_eval(n[1], ctx))
        return None if v is None else not v
    if k == "and":
        a, b = _tri(_eval(n[1], ctx)), _tri(_eval(n[2], ctx))
        if a is False or b is False:
            return False
        return None if a is None or b is None else True
    if k == "or":
        a, b = _tri(_eval(n[1], ctx)), _tri(_eval(n[2], ctx))
        if a is True or b is True:
            return True
        return None if a is None or b is None else False
    if k == "cmp":
        a, b = _eval(n[2], ctx), _eval(n[3], ctx)
        if ctx["default_zero"] and n[1] not in ("in", "=", "!="):
            a = 0.0 if a is None else a
            b = 0.0 if b is None else b
        return _compare(n[1], a, b)
    if k == "isnull":
        return _eval(n[1], ctx) is None
    if k == "match":
        v = _eval(n[1], ctx)
        if v is None or not isinstance(v, str):
            return None
        pat = n[2]
        if not SAFE_PATTERN.match(pat) or NESTED_QUANTIFIER.search(pat):
            return None
        # "$" in JavaScript does not match before a final newline; "\Z" is the Python equivalent.
        if pat.endswith("$") and not pat.endswith("\\$"):
            pat = pat[:-1] + "\\Z"
        return re.search(pat, v) is not None
    if k == "if":
        c = _tri(_eval(n[1], ctx))
        if c is True:
            return _eval(n[2], ctx)
        if c is False:
            return True if n[3] is None else _eval(n[3], ctx)
        return None
    return None


def evaluate_rule(rule, template, row, existence):
    """Failures of a rule on one row: a list of column codes (None when not column-specific)."""
    used = referenced_columns(rule["expr"], template)
    if not existence and not any(row.get(c) for c in used):
        return []
    multi = [n for n in _walk(rule["expr"]) if n[0] == "select" and len(selection_columns(n, template)) != 1]
    base = {"template": template, "row": row, "default_zero": rule["default_zero"]}
    if not multi:
        r = _tri(_eval(rule["expr"], dict(base, bound={})))
        return [None] if r is False else []
    sel = multi[0]
    out = []
    for col in selection_columns(sel, template):
        r = _tri(_eval(rule["expr"], dict(base, bound={id(sel): col})))
        if r is False:
            out.append(col)
    return out
