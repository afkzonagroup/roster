// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { allowedValues } from '../taxonomy/dora.ts';
import type { Column, Taxonomy, Template } from '../taxonomy/types.ts';

/** Header forms accepted for a column: `c0010`, `0010`, `B_01.01.0010`, `B_01.01.c0010` (any case). */
const HEADER = /^(?:(B[_ .]?[0-9]{2}[_ .][0-9]{2})[_ .])?c?([0-9]{4})$/i;

/** Normalises a template code written as `B_01.01`, `b 01 01`, `B.01.01` or `B0101`. */
export function normaliseTemplateCode(text: string): string | null {
  const m = /^\s*t?B[_ .-]?([0-9]{2})[_ .-]?([0-9]{2})\s*$/i.exec(text);
  return m === null ? null : `B_${m[1] ?? ''}.${m[2] ?? ''}`;
}

/** Parses a header cell. Returns the column code (`c0010`), `null` for a non-code, or an error string. */
export function parseHeader(text: string, template: string): string | null | { error: string } {
  const t = text.trim();
  const m = HEADER.exec(t);
  if (m === null) return null;
  if (m[1] !== undefined && normaliseTemplateCode(m[1]) !== template) return { error: `header "${t}" belongs to another template` };
  return `c${m[2] ?? ''}`;
}

const squash = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Lookup tables to turn spreadsheet entries into closed-list codes. Built once per column. */
const aliasCache = new WeakMap<Column, Map<string, string | null>>();

function aliases(column: Column, taxonomy: Taxonomy): Map<string, string | null> {
  let map = aliasCache.get(column);
  if (map !== undefined) return map;
  const m = new Map<string, string | null>();
  map = m;
  const add = (alias: string, code: string): void => {
    const k = squash(alias);
    if (k === '') return;
    const prev = m.get(k);
    // An alias that would mean two codes is ambiguous and not used.
    if (prev === undefined) m.set(k, code);
    else if (prev !== code) m.set(k, null);
  };
  for (const code of allowedValues(column, taxonomy)) {
    const [prefix, local] = code.split(':');
    add(code, code);
    add(`${(prefix ?? '').replace(/^eba_/, '')}:${local ?? ''}`, code);
    const label = taxonomy.labels[code];
    if (label !== undefined) {
      add(label, code);
      // Abbreviation in brackets at the end of a label, e.g. "European Unified ID (EUID)".
      const abbr = /\(([A-Z]{2,6})\)$/.exec(label);
      if (abbr !== null) add(abbr[1] ?? '', code);
    }
    // ISO codes for countries (GA domain) and currencies (CU domain).
    if ((prefix === 'eba_GA' && /^[A-Z]{2}$/.test(local ?? '')) || (prefix === 'eba_CU' && /^[A-Z]{3}$/.test(local ?? ''))) add(local ?? '', code);
  }
  aliasCache.set(column, map);
  return map;
}

/** Expands a number in scientific notation (`1.5E+3`) to plain decimal text without going through floating point. */
export function expandExponent(text: string): string | null {
  const m = /^([+-]?)([0-9]+)(?:\.([0-9]*))?[eE]([+-]?[0-9]{1,4})$/.exec(text);
  if (m === null) return null;
  const sign = m[1] === '-' ? '-' : '';
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  const exp = Number(m[4]);
  const digits = int + frac;
  const point = int.length + exp;
  let out: string;
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  out = out.replace(/^0+(?=[0-9])/, '');
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return sign + out;
}

/** What happened to a value on import. */
export type Conversion = 'none' | 'code' | 'number' | 'date';

/**
 * Turns a cell as typed in a spreadsheet into the register value for the
 * column. Closed-list columns accept the taxonomy code (`eba_GA:LU`), the code
 * without `eba_` (`GA:LU`), the ISO code for countries and currencies
 * (`LU`, `EUR`), the English label of the taxonomy (`Luxembourg`,
 * `Credit institutions`) or the abbreviation in a label (`LEI`, `EUID`).
 * Ambiguous entries are left unchanged so validation reports them. Numbers in
 * scientific notation are expanded exactly. Nothing else is changed.
 */
export function normaliseValue(column: Column, text: string, taxonomy: Taxonomy): { value: string; conversion: Conversion } {
  if (column.type === 'e') {
    if (allowedValues(column, taxonomy).includes(text)) return { value: text, conversion: 'none' };
    const code = aliases(column, taxonomy).get(squash(text));
    return code === undefined || code === null ? { value: text, conversion: 'none' } : { value: code, conversion: 'code' };
  }
  if (column.type === 'm' || column.type === 'i') {
    const plain = expandExponent(text);
    if (plain !== null) return { value: plain, conversion: 'number' };
  }
  if (column.type === 't' && /^(true|1)$/i.test(text)) return { value: 'true', conversion: text === 'true' ? 'none' : 'code' };
  return { value: text, conversion: 'none' };
}

/** Decides whether a spreadsheet row just below the header only repeats column names or types. */
export function isDescriptorRow(template: Template, cells: ReadonlyMap<string, string>): boolean {
  let seen = 0;
  for (const [code, text] of cells) {
    const col = template.columns.find((c) => c.code === code);
    if (col === undefined) return false;
    const t = squash(text);
    const known = [col.label, col.its?.name ?? '', col.its?.type ?? '', col.code, col.its?.code ?? ''].map(squash);
    if (!known.includes(t)) return false;
    seen++;
  }
  return seen > 0;
}
