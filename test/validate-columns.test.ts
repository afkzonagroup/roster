// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Every column of every template, from the official data: wrong values of
// its type are rejected with the matching ESAs check, valid values pass,
// key columns may never be empty, and ITS "Mandatory" columns warn when empty.

import { describe, expect, it } from 'vitest';
import { DORA_4_0, allowedValues } from '../src/taxonomy/dora.ts';
import type { Column, Template } from '../src/taxonomy/types.ts';
import { validateRegister } from '../src/validate/register.ts';
import { exampleRegister } from '../src/example.ts';
import { exampleRows, registerOf, rules } from './helpers.ts';

/** A valid value for a column, taken from the example register where possible. */
function validValue(t: Template, c: Column): string {
  const ex = exampleRegister().tables.get(t.code)?.rows.find((r) => r.values[c.code] !== undefined)?.values[c.code];
  if (ex !== undefined) return ex;
  if (c.lei) return '506700GE1G29325QX363';
  switch (c.type) {
    case 'e':
      return allowedValues(c)[0] ?? '';
    case 'd':
      return '2025-01-31';
    case 'i':
      return '1';
    case 'm':
      return '1000.50';
    case 't':
      return 'true';
    default:
      return 'Text';
  }
}

const INVALID: Record<string, [string, string][]> = {
  e: [['eba_XX:x1', 'esa.503'], ['Luxembourg?', 'esa.503']],
  d: [['31.12.2025', 'esa.330'], ['2025-02-30', 'esa.330']],
  i: [['1.5', 'esa.331'], ['one', 'esa.331']],
  m: [['1,000', 'esa.305'], ['EUR 5', 'esa.305'], ['1e5', 'esa.305']],
  t: [['false', 'esa.333'], ['1', 'esa.333']],
};

const cases = DORA_4_0.templates.flatMap((t) => t.columns.map((c) => [`${t.code} ${c.code}`, t, c] as const));

/** A register with one row in the given template holding just this value (plus the other keys). */
function oneRow(t: Template, c: Column, value: string | undefined): ReturnType<typeof registerOf> {
  const rows = exampleRows();
  const row: Record<string, string> = { ...(rows.get(t.code)?.[0] ?? {}) };
  for (const k of t.primaryKey) row[k] ??= validValue(t, t.columns.find((x) => x.code === k) ?? c);
  if (value === undefined) Reflect.deleteProperty(row, c.code);
  else row[c.code] = value;
  rows.set(t.code, [row]);
  return registerOf(rows);
}

describe.each(cases)('column %s', (_name, t, c) => {
  it('accepts a valid value of its type', () => {
    const r = validateRegister(oneRow(t, c, validValue(t, c)));
    const here = r.findings.filter((f) => f.template === t.code && f.column === c.code && f.severity === 'error');
    expect(here).toEqual([]);
  });

  if (INVALID[c.type] !== undefined) {
    it.each(INVALID[c.type] ?? [])('rejects %s with %s', (bad, rule) => {
      const r = validateRegister(oneRow(t, c, bad));
      expect(r.findings.some((f) => f.rule === rule && f.template === t.code && f.column === c.code)).toBe(true);
    });
  }

  if (c.key) {
    it('is a key column and may not be empty (ESAs check 805)', () => {
      const r = validateRegister(oneRow(t, c, undefined));
      expect(r.findings.some((f) => f.rule === 'esa.805' && f.column === c.code && f.severity === 'error')).toBe(true);
    });
  } else if (c.its?.status === 'mandatory') {
    it('warns when empty because the ITS marks it Mandatory', () => {
      const r = validateRegister(oneRow(t, c, undefined));
      expect(r.findings.some((f) => f.rule === 'its.mandatory' && f.column === c.code && f.severity === 'warning')).toBe(true);
    });
  } else if (c.its?.status === 'reporting') {
    it('is mandatory only when reporting', () => {
      expect(validateRegister(oneRow(t, c, undefined)).findings.some((f) => f.rule === 'its.mandatory' && f.column === c.code)).toBe(false);
      expect(validateRegister(oneRow(t, c, undefined), { reporting: true }).findings.some((f) => f.rule === 'its.mandatory' && f.column === c.code)).toBe(true);
    });
  }

  if (c.lei) {
    it('requires an LEI with correct check digits', () => {
      expect(rules(validateRegister(oneRow(t, c, '506700GE1G29325QX364')).findings.filter((f) => f.column === c.code))).toContain('its.lei');
    });
  }
});

describe('cell checks from the ITS and xBRL-CSV', () => {
  const at = (template: string, column: string, value: string): string[] => {
    const rows = exampleRows();
    const r = rows.get(template)?.[0];
    if (r === undefined) throw new Error('no row');
    r[column] = value;
    return rules(validateRegister(registerOf(rows)).findings.filter((f) => f.template === template && f.column === column));
  };

  it('the identification code must be an LEI or EUID when its type of code says so', () => {
    expect(at('B_05.01', 'c0010', 'NOT-AN-LEI')).toContain('its.lei');
    const rows = exampleRows();
    const p = rows.get('B_05.01')?.[1];
    if (p === undefined) throw new Error('no row');
    p.c0010 = 'NOEUIDSTRUCTURE';
    expect(rules(validateRegister(registerOf(rows)).findings.filter((f) => f.column === 'c0010' && f.template === 'B_05.01'))).toContain('its.euid');
  });

  it('natural numbers, rank, function identifier and maximum length', () => {
    expect(at('B_02.02', 'c0100', '-5')).toContain('its.natural-number');
    expect(at('B_05.02', 'c0050', '0')).toContain('its.rank');
    expect(at('B_06.01', 'c0010', 'Function 1')).toContain('its.function-identifier');
    expect(at('B_06.01', 'c0060', 'x'.repeat(301))).toContain('its.max-length');
    expect(at('B_06.01', 'c0060', 'é'.repeat(300))).not.toContain('its.max-length');
  });

  it('characters: xBRL-CSV forbidden, invisible, whitespace, formula-like', () => {
    expect(at('B_05.01', 'c0050', `Name${String.fromCharCode(1)}`)).toContain('xbrl-csv.character');
    expect(at('B_05.01', 'c0050', `Name${String.fromCharCode(0x202e)}`)).toContain('roster.suspicious-character');
    expect(at('B_05.01', 'c0050', `Name${String.fromCharCode(0x85)}`)).toContain('roster.suspicious-character');
    expect(at('B_05.01', 'c0050', ' Name ')).toContain('roster.whitespace');
    expect(at('B_05.01', 'c0050', '=HYPERLINK("http://x")')).toContain('roster.formula-like');
    expect(at('B_05.01', 'c0050', 'Line one\nline two')).toEqual([]);
  });

  it('reports a column that is not in the template (ESAs check 801)', () => {
    expect(rules(validateRegister(registerOf(new Map([['B_01.01', [{ c0010: '506700GE1G29325QX363', c9999: 'x' }]]]))).findings)).toContain('esa.801');
  });
});
