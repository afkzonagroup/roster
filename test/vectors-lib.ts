// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { makeRegister, type Register, type RegisterRow } from '../src/model/register.ts';
import { validateRegister, type ValidateOptions } from '../src/validate/register.ts';

/**
 * One change to a register: set (value) or clear (null) a cell. Row indexes
 * past the end add rows; column "*copy" copies row `value` (an index) first.
 */
export interface Patch {
  readonly template: string;
  readonly row: number;
  readonly column: string;
  readonly value: string | null;
}

export interface VectorCase {
  readonly name: string;
  readonly patch: readonly Patch[];
  readonly options: Pick<ValidateOptions, 'reporting' | 'referenceDate' | 'includeInactiveRules'>;
  /** Sorted "severity|rule|template|row|column" strings. */
  readonly expected: readonly string[];
}

export function applyPatch(base: Register, patch: readonly Patch[]): Register {
  const rows = new Map<string, Record<string, string>[]>();
  for (const [code, t] of base.tables) rows.set(code, t.rows.map((r) => ({ ...r.values })));
  for (const p of patch) {
    const list = rows.get(p.template) ?? [];
    rows.set(p.template, list);
    while (list.length <= p.row) list.push({});
    const row = list[p.row] ?? {};
    if (p.column === '*copy') Object.assign(row, list[Number(p.value)] ?? {});
    else if (p.value === null) Reflect.deleteProperty(row, p.column);
    else row[p.column] = p.value;
  }
  const out = new Map<string, RegisterRow[]>();
  for (const [code, list] of rows) out.set(code, list.map((values, i) => ({ values, origin: { source: code, line: i + 2 } })));
  return makeRegister(out);
}

export function expectedFindings(register: Register, options: VectorCase['options']): string[] {
  return validateRegister(register, options)
    .findings.map((f) => `${f.severity}|${f.rule}|${f.template ?? ''}|${f.row ?? ''}|${f.column ?? ''}`)
    .sort();
}
