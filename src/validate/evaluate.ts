// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { DpmNode, ParsedRule, SelectionNode } from './dpmxl.ts';
import type { Template } from '../taxonomy/types.ts';

/**
 * Three-valued result: `true`, `false`, or `null` when the expression cannot
 * be evaluated because a value is missing. Like XBRL formula assertions with
 * fallback values, a rule only fails on a definite `false`.
 */
export type Tri = boolean | null;

type Value = string | number | boolean | null | readonly string[];

/** Expands a selection to concrete column codes of the template. */
export function selectionColumns(sel: SelectionNode, template: Template): string[] {
  const nonKey = template.columns.filter((c) => !c.key).map((c) => c.code);
  if (sel.columns === '*') return nonKey;
  if (sel.range !== null) {
    const [from, to] = sel.range;
    return template.columns.map((c) => c.code).filter((c) => c >= from && c <= to);
  }
  return [...sel.columns];
}

/** Finds the column that holds a key dimension, e.g. `ERI` → `c0010` when the table maps `eba_dim_3.5:ERI` to `$c0010`. */
function columnOfDimension(template: Template, dim: string): string | undefined {
  return template.columns.find((c) => c.key && c.dimension !== null && c.dimension.split(':').pop() === dim)?.code;
}

/** Lists every selection with more than one column (evaluated column by column). */
function multiSelections(node: DpmNode, template: Template, out: SelectionNode[]): void {
  switch (node.kind) {
    case 'select':
      if (selectionColumns(node, template).length !== 1) out.push(node);
      return;
    case 'not':
    case 'isnull':
    case 'match':
      multiSelections(node.arg, template, out);
      return;
    case 'and':
    case 'or':
    case 'cmp':
      multiSelections(node.left, template, out);
      multiSelections(node.right, template, out);
      return;
    case 'if':
      multiSelections(node.cond, template, out);
      multiSelections(node.then, template, out);
      if (node.else !== null) multiSelections(node.else, template, out);
      return;
    default:
      return;
  }
}

/** Every column the expression reads (for the "all inputs missing" test). */
export function referencedColumns(node: DpmNode, template: Template, out = new Set<string>()): Set<string> {
  switch (node.kind) {
    case 'select':
      for (const c of selectionColumns(node, template)) out.add(c);
      if (node.get !== null) {
        const k = columnOfDimension(template, node.get);
        if (k !== undefined) out.add(k);
      }
      return out;
    case 'not':
    case 'isnull':
    case 'match':
      return referencedColumns(node.arg, template, out);
    case 'and':
    case 'or':
    case 'cmp':
      referencedColumns(node.left, template, out);
      return referencedColumns(node.right, template, out);
    case 'if':
      referencedColumns(node.cond, template, out);
      referencedColumns(node.then, template, out);
      if (node.else !== null) referencedColumns(node.else, template, out);
      return out;
    default:
      return out;
  }
}

/** Checks the rule can be evaluated against the template (dimensions of `[get]` exist, columns exist). */
export function checkEvaluable(rule: ParsedRule, template: Template): string | null {
  const problems: string[] = [];
  const visit = (n: DpmNode): void => {
    switch (n.kind) {
      case 'select': {
        if (n.table !== null && n.table !== template.code) problems.push(`refers to another table (${n.table})`);
        for (const c of selectionColumns(n, template)) if (!template.columns.some((x) => x.code === c)) problems.push(`column ${c} is not in ${template.code}`);
        if (n.get !== null && columnOfDimension(template, n.get) === undefined) problems.push(`dimension ${n.get} is not a key of ${template.code}`);
        return;
      }
      case 'not':
      case 'isnull':
      case 'match':
        visit(n.arg);
        return;
      case 'and':
      case 'or':
      case 'cmp':
        visit(n.left);
        visit(n.right);
        return;
      case 'if':
        visit(n.cond);
        visit(n.then);
        if (n.else !== null) visit(n.else);
        return;
      default:
        return;
    }
  };
  visit(rule.expr);
  const multi: SelectionNode[] = [];
  multiSelections(rule.expr, template, multi);
  if (multi.length > 1) problems.push('more than one multi-column selection');
  return problems.length === 0 ? null : problems.join('; ');
}

const NUMBER = /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/;

function compare(op: string, a: Value, b: Value): Tri {
  if (op === 'in') {
    if (a === null || typeof a !== 'string' || !Array.isArray(b)) return null;
    return b.includes(a);
  }
  if (a === null || b === null || Array.isArray(a) || Array.isArray(b)) return null;
  let x: string | number | boolean = a as string | number | boolean;
  let y: string | number | boolean = b as string | number | boolean;
  if (typeof x === 'string' && typeof y === 'number' && NUMBER.test(x)) x = Number(x);
  if (typeof y === 'string' && typeof x === 'number' && NUMBER.test(y)) y = Number(y);
  if (typeof x === 'string' && typeof y === 'string' && NUMBER.test(x) && NUMBER.test(y) && (op !== '=' && op !== '!=')) {
    x = Number(x);
    y = Number(y);
  }
  if (typeof x !== typeof y) return op === '!=' ? true : op === '=' ? false : null;
  switch (op) {
    case '=':
      return x === y;
    case '!=':
      return x !== y;
    case '>':
      return x > y;
    case '>=':
      return x >= y;
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    default:
      return null;
  }
}

/** Patterns from the official rules are compiled once; only a safe character set is accepted. */
const patternCache = new Map<string, RegExp | null>();
function compilePattern(p: string): RegExp | null {
  let re = patternCache.get(p);
  if (re === undefined) {
    // Nested quantifiers such as (a+)+ could backtrack catastrophically: refused.
    const safe = /^[\w^$[\]{}(),.|?*+\\-]{1,200}$/.test(p) && !/\([^)]*[+*}][^)]*\)[+*{?]/.test(p);
    re = safe ? new RegExp(p, 'u') : null;
    patternCache.set(p, re);
  }
  return re;
}

interface Ctx {
  readonly template: Template;
  readonly row: Readonly<Record<string, string>>;
  readonly defaultZero: boolean;
  /** Binding of the multi-column selection to one column. */
  readonly bound: ReadonlyMap<SelectionNode, string>;
}

function cellValue(ctx: Ctx, column: string): string | null {
  const v = ctx.row[column];
  return v === undefined || v === '' ? null : v;
}

function evalNode(n: DpmNode, ctx: Ctx): Value {
  switch (n.kind) {
    case 'select': {
      const col = ctx.bound.get(n) ?? selectionColumns(n, ctx.template)[0] ?? '';
      const v = cellValue(ctx, col);
      if (n.get === null) return v;
      if (v === null) return null;
      const keyCol = columnOfDimension(ctx.template, n.get);
      return keyCol === undefined ? null : cellValue(ctx, keyCol);
    }
    case 'member':
      return n.qname;
    case 'members':
      return n.qnames;
    case 'number':
      return n.value;
    case 'string':
      return n.value;
    case 'not': {
      const v = asTri(evalNode(n.arg, ctx));
      return v === null ? null : !v;
    }
    case 'and': {
      const a = asTri(evalNode(n.left, ctx));
      const b = asTri(evalNode(n.right, ctx));
      if (a === false || b === false) return false;
      return a === null || b === null ? null : true;
    }
    case 'or': {
      const a = asTri(evalNode(n.left, ctx));
      const b = asTri(evalNode(n.right, ctx));
      if (a === true || b === true) return true;
      return a === null || b === null ? null : false;
    }
    case 'cmp': {
      let a = evalNode(n.left, ctx);
      let b = evalNode(n.right, ctx);
      // "default: 0" replaces a missing numeric operand by zero.
      if (ctx.defaultZero && n.op !== 'in' && n.op !== '=' && n.op !== '!=') {
        if (a === null) a = 0;
        if (b === null) b = 0;
      }
      return compare(n.op, a, b);
    }
    case 'isnull':
      return evalNode(n.arg, ctx) === null;
    case 'match': {
      const v = evalNode(n.arg, ctx);
      if (v === null || typeof v !== 'string') return null;
      const re = compilePattern(n.pattern);
      return re === null ? null : re.test(v);
    }
    case 'if': {
      const c = asTri(evalNode(n.cond, ctx));
      if (c === true) return evalNode(n.then, ctx);
      if (c === false) return n.else === null ? true : evalNode(n.else, ctx);
      return null;
    }
  }
}

function asTri(v: Value): Tri {
  if (v === null) return null;
  if (typeof v === 'boolean') return v;
  return null;
}

/** One failure of a rule on a row; `column` is set for column-by-column rules. */
export interface RuleFailure {
  readonly column: string | null;
}

/**
 * Evaluates a parsed rule on one row. Rows where every column the rule
 * reads is empty are skipped (no evaluation, as for XBRL formula assertions
 * whose variables all fall back). A selection of several columns is
 * evaluated once per column (DPM-XL applies operators element by element).
 * Existence rules (`isnull` over every column of the selection) are
 * evaluated for every row of a reported template.
 */
export function evaluateRule(rule: ParsedRule, template: Template, row: Readonly<Record<string, string>>, existence: boolean): RuleFailure[] {
  const used = referencedColumns(rule.expr, template);
  if (!existence && ![...used].some((c) => (row[c] ?? '') !== '')) return [];
  const multi: SelectionNode[] = [];
  multiSelections(rule.expr, template, multi);
  const sel = multi[0];
  const failures: RuleFailure[] = [];
  if (sel === undefined) {
    const r = asTri(evalNode(rule.expr, { template, row, defaultZero: rule.defaultZero, bound: new Map() }));
    if (r === false) failures.push({ column: null });
    return failures;
  }
  for (const col of selectionColumns(sel, template)) {
    const r = asTri(evalNode(rule.expr, { template, row, defaultZero: rule.defaultZero, bound: new Map([[sel, col]]) }));
    if (r === false) failures.push({ column: col });
  }
  return failures;
}
