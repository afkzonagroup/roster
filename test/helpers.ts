// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { exampleRegister } from '../src/example.ts';
import { makeRegister, type Register, type RegisterRow } from '../src/model/register.ts';
import type { Finding } from '../src/validate/finding.ts';

/** Fixed time for tests. */
export const NOW = new Date('2026-01-20T10:00:00.000Z');

/** Rows of the example register as plain objects, ready to change. */
export function exampleRows(): Map<string, Record<string, string>[]> {
  const out = new Map<string, Record<string, string>[]>();
  for (const [code, table] of exampleRegister().tables) out.set(code, table.rows.map((r) => ({ ...r.values })));
  return out;
}

/** Builds a register from plain row objects. */
export function registerOf(rows: Map<string, Record<string, string>[]>): Register {
  const m = new Map<string, RegisterRow[]>();
  for (const [code, list] of rows) m.set(code, list.map((values, i) => ({ values, origin: { source: code, line: i + 2 } })));
  return makeRegister(m);
}

/** The example register with one change applied. */
export function changed(fn: (rows: Map<string, Record<string, string>[]>) => void): Register {
  const rows = exampleRows();
  fn(rows);
  return registerOf(rows);
}

/** First row of a template in a row map. */
export function first(rows: Map<string, Record<string, string>[]>, template: string): Record<string, string> {
  const r = rows.get(template)?.[0];
  if (r === undefined) throw new Error(`no row in ${template}`);
  return r;
}

/** Rule ids of findings, sorted and unique. */
export function rules(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map((f) => f.rule))].sort();
}
