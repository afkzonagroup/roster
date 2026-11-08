// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A parser for the subset of DPM-XL (the EBA's validation rule language)
 * used by the DORA validation rules of the EBA reporting framework. Rules are
 * parsed into a small syntax tree and evaluated by {@link evaluateRule};
 * nothing is ever turned into executable code. Expressions outside the
 * subset are reported as not evaluable, never guessed.
 */

/** Column selection: one or more columns of the rule's table, optionally `[get DIM]`. */
export interface SelectionNode {
  readonly kind: 'select';
  readonly table: string | null;
  /** Column codes, or `*` for all non-key columns of the table. */
  readonly columns: readonly string[] | '*';
  /** Range form `c0020-0090`: inclusive bounds. */
  readonly range: readonly [string, string] | null;
  /** `[get DIM]`: the dimension whose key value is taken instead of the fact. */
  readonly get: string | null;
}

export type DpmNode =
  | SelectionNode
  | { readonly kind: 'member'; readonly qname: string }
  | { readonly kind: 'members'; readonly qnames: readonly string[] }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'not'; readonly arg: DpmNode }
  | { readonly kind: 'and' | 'or'; readonly left: DpmNode; readonly right: DpmNode }
  | { readonly kind: 'cmp'; readonly op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in'; readonly left: DpmNode; readonly right: DpmNode }
  | { readonly kind: 'isnull'; readonly arg: DpmNode }
  | { readonly kind: 'match'; readonly arg: DpmNode; readonly pattern: string }
  | { readonly kind: 'if'; readonly cond: DpmNode; readonly then: DpmNode; readonly else: DpmNode | null };

/** A parsed rule: optional `with` scope and the boolean expression. */
export interface ParsedRule {
  readonly table: string | null;
  readonly defaultZero: boolean;
  readonly expr: DpmNode;
}

type Tok =
  | { t: 'kw'; v: string }
  | { t: 'sym'; v: string }
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'sel'; v: string }
  | { t: 'mem'; v: string };

class ParseError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] ?? '';
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '{') {
      // A selection {...} or a set of members {[a], [b]}.
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= n) throw new ParseError('unbalanced braces');
      const inner = src.slice(i + 1, j).trim();
      if (inner.startsWith('[')) {
        const members = inner.split(',').map((s) => s.trim());
        for (const m of members) if (!/^\[[A-Za-z_][\w.]*:[\w.]+\]$/.test(m)) throw new ParseError(`bad member set ${inner}`);
        out.push({ t: 'sym', v: '{set' });
        for (const m of members) out.push({ t: 'mem', v: m.slice(1, -1) });
        out.push({ t: 'sym', v: 'set}' });
      } else out.push({ t: 'sel', v: inner });
      i = j + 1;
      continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new ParseError('unbalanced brackets');
      const inner = src.slice(i + 1, j).trim();
      const get = /^get\s+([A-Za-z0-9_]+)$/.exec(inner);
      if (get !== null) out.push({ t: 'kw', v: `get:${get[1] ?? ''}` });
      else if (/^[A-Za-z_][\w.]*:[\w.]+$/.test(inner)) out.push({ t: 'mem', v: inner });
      else throw new ParseError(`unsupported bracket ${inner}`);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) throw new ParseError('unterminated string');
      out.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '!=' || two === '>=' || two === '<=') {
      out.push({ t: 'sym', v: two });
      i += 2;
      continue;
    }
    if ('()=<>,:'.includes(c)) {
      out.push({ t: 'sym', v: c });
      i++;
      continue;
    }
    const num = /^-?[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
    if (num !== null) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (word !== null) {
      out.push({ t: 'kw', v: word[0].toLowerCase() });
      i += word[0].length;
      continue;
    }
    throw new ParseError(`unexpected character ${c}`);
  }
  return out;
}

const COL = /^c[0-9]{4}$/;

function parseSelection(text: string): SelectionNode {
  let table: string | null = null;
  let rest = text;
  const tm = /^(tB_[0-9]{2}\.[0-9]{2})\s*,\s*(.+)$/.exec(text);
  if (tm !== null) {
    table = (tm[1] ?? '').slice(1);
    rest = (tm[2] ?? '').trim();
  }
  if (rest === 'c*') return { kind: 'select', table, columns: '*', range: null, get: null };
  const range = /^c([0-9]{4})-([0-9]{4})$/.exec(rest);
  if (range !== null) return { kind: 'select', table, columns: [], range: [`c${range[1] ?? ''}`, `c${range[2] ?? ''}`], get: null };
  const list = /^\((.+)\)$/.exec(rest);
  const cols = (list !== null ? (list[1] ?? '').split(',') : [rest]).map((s) => s.trim());
  for (const c of cols) if (!COL.test(c)) throw new ParseError(`unsupported selection ${text}`);
  return { kind: 'select', table, columns: cols, range: null, get: null };
}

class Parser {
  private i = 0;
  private readonly toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private isKw(v: string): boolean {
    const t = this.peek();
    return t?.t === 'kw' && t.v === v;
  }
  private isSym(v: string): boolean {
    const t = this.peek();
    return t?.t === 'sym' && t.v === v;
  }
  private expectSym(v: string): void {
    if (!this.isSym(v)) throw new ParseError(`expected ${v}`);
    this.i++;
  }
  private expectKw(v: string): void {
    if (!this.isKw(v)) throw new ParseError(`expected ${v}`);
    this.i++;
  }
  done(): boolean {
    return this.i >= this.toks.length;
  }
  rule(): ParsedRule {
    let table: string | null = null;
    let defaultZero = false;
    if (this.isKw('with')) {
      this.i++;
      const sel = this.peek();
      if (sel?.t !== 'sel') throw new ParseError('expected scope');
      this.i++;
      const parts = sel.v.split(',').map((s) => s.trim());
      const t = /^tB_([0-9]{2}\.[0-9]{2})$/.exec(parts[0] ?? '');
      if (t === null) throw new ParseError('expected table in scope');
      table = `B_${t[1] ?? ''}`;
      for (const p of parts.slice(1)) {
        const m = /^(default|interval)\s*:\s*(\S+)$/.exec(p);
        if (m === null) throw new ParseError(`unsupported scope option ${p}`);
        if (m[1] === 'default') {
          if (m[2] === '0') defaultZero = true;
          else if (m[2] !== 'null') throw new ParseError(`unsupported default ${m[2] ?? ''}`);
        } else if (m[2] !== 'false') throw new ParseError('unsupported interval option');
      }
      this.expectSym(':');
    }
    const expr = this.or();
    if (!this.done()) throw new ParseError('trailing input');
    return { table, defaultZero, expr };
  }
  private or(): DpmNode {
    let left = this.and();
    while (this.isKw('or')) {
      this.i++;
      left = { kind: 'or', left, right: this.and() };
    }
    return left;
  }
  private and(): DpmNode {
    let left = this.cmp();
    while (this.isKw('and')) {
      this.i++;
      left = { kind: 'and', left, right: this.cmp() };
    }
    return left;
  }
  private cmp(): DpmNode {
    const left = this.unary();
    const t = this.peek();
    if (t?.t === 'sym' && ['=', '!=', '>', '>=', '<', '<='].includes(t.v)) {
      this.i++;
      return { kind: 'cmp', op: t.v as '=' | '!=' | '>' | '>=' | '<' | '<=', left, right: this.unary() };
    }
    if (this.isKw('in')) {
      this.i++;
      return { kind: 'cmp', op: 'in', left, right: this.unary() };
    }
    return left;
  }
  private unary(): DpmNode {
    if (this.isKw('not')) {
      this.i++;
      return { kind: 'not', arg: this.unary() };
    }
    return this.primary();
  }
  private primary(): DpmNode {
    const t = this.peek();
    if (t === undefined) throw new ParseError('unexpected end');
    if (t.t === 'sym' && t.v === '(') {
      this.i++;
      const e = this.or();
      this.expectSym(')');
      return e;
    }
    if (t.t === 'kw' && t.v === 'if') {
      this.i++;
      const cond = this.or();
      this.expectKw('then');
      const then = this.or();
      let otherwise: DpmNode | null = null;
      if (this.isKw('else')) {
        this.i++;
        otherwise = this.or();
      }
      this.expectKw('endif');
      return { kind: 'if', cond, then, else: otherwise };
    }
    if (t.t === 'kw' && t.v === 'isnull') {
      this.i++;
      this.expectSym('(');
      const arg = this.or();
      this.expectSym(')');
      return { kind: 'isnull', arg };
    }
    if (t.t === 'kw' && t.v === 'match') {
      this.i++;
      this.expectSym('(');
      const arg = this.or();
      this.expectSym(',');
      const p = this.peek();
      if (p?.t !== 'str') throw new ParseError('expected pattern');
      this.i++;
      this.expectSym(')');
      return { kind: 'match', arg, pattern: p.v };
    }
    if (t.t === 'sel') {
      this.i++;
      let sel = parseSelection(t.v);
      const g = this.peek();
      if (g?.t === 'kw' && g.v.startsWith('get:')) {
        this.i++;
        sel = { ...sel, get: g.v.slice(4).toUpperCase() };
      }
      return sel;
    }
    if (t.t === 'mem') {
      this.i++;
      return { kind: 'member', qname: t.v };
    }
    if (t.t === 'sym' && t.v === '{set') {
      this.i++;
      const qnames: string[] = [];
      for (;;) {
        const m = this.peek();
        if (m?.t === 'mem') {
          qnames.push(m.v);
          this.i++;
        } else break;
      }
      this.expectSym('set}');
      return { kind: 'members', qnames };
    }
    if (t.t === 'num') {
      this.i++;
      return { kind: 'number', value: t.v };
    }
    if (t.t === 'str') {
      this.i++;
      return { kind: 'string', value: t.v };
    }
    throw new ParseError(`unexpected ${t.t === 'kw' ? t.v : t.t}`);
  }
}

/** Parses a DPM-XL expression, or returns the reason it is outside the supported subset. */
export function parseDpmXl(expression: string): { ok: true; rule: ParsedRule } | { ok: false; reason: string } {
  try {
    const p = new Parser(tokenize(expression));
    return { ok: true, rule: p.rule() };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, reason: e.message };
    throw e;
  }
}
