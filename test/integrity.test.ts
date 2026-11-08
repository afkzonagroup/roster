// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Cross-template referential integrity (ESAs check 807) for every reference
// key of the taxonomy, and key uniqueness (ESAs check 806).

import { describe, expect, it } from 'vitest';
import { DORA_4_0 } from '../src/taxonomy/dora.ts';
import { validateRegister } from '../src/validate/register.ts';
import { exampleRows, registerOf } from './helpers.ts';

const refs = DORA_4_0.templates.flatMap((t) => t.references.map((r) => [`${t.code} ${r.columns.join('+')} -> ${r.target}`, t.code, r] as const));

describe.each(refs)('reference key %s', (_name, table, ref) => {
  it('fails when the referenced row does not exist, passes when it does', () => {
    const rows = exampleRows();
    let list = rows.get(table) ?? [];
    const template = DORA_4_0.templates.find((t) => t.code === table);
    if (template === undefined) throw new Error(table);
    if (list.length === 0) {
      // Build a row from the referenced values of the example register.
      const target = rows.get(ref.target)?.[0] ?? {};
      const targetTemplate = DORA_4_0.templates.find((t) => t.code === ref.target);
      const row: Record<string, string> = { c0010: 'EX-2025-001' };
      ref.columns.forEach((c, i) => (row[c] = target[targetTemplate?.primaryKey[i] ?? ''] ?? ''));
      for (const k of template.primaryKey) row[k] ??= 'EX-2025-002';
      list = [row];
      rows.set(table, list);
    }
    const okRun = validateRegister(registerOf(rows)).findings.filter((f) => f.rule === 'esa.807' && f.template === table && f.message.includes(ref.name));
    expect(okRun).toEqual([]);
    const row = list[0];
    if (row === undefined) throw new Error('no row');
    row[ref.columns[0] ?? ''] = 'NO-SUCH-VALUE';
    const bad = validateRegister(registerOf(rows)).findings.filter((f) => f.rule === 'esa.807' && f.template === table && f.message.includes(ref.name));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]?.severity).toBe('error');
  });
});

describe('key checks', () => {
  it('rejects two rows with the same key values (806), comparing integers by value', () => {
    const rows = exampleRows();
    const sc = rows.get('B_05.02') ?? [];
    sc.push({ ...(sc[0] ?? {}), c0050: '01' });
    const r = validateRegister(registerOf(rows));
    expect(r.findings.filter((f) => f.rule === 'esa.806' && f.template === 'B_05.02')).toHaveLength(1);
  });

  it('a template without key columns (B_99.01) can have only one row', () => {
    const rows = exampleRows();
    rows.get('B_99.01')?.push({ c0020: 'second row' });
    expect(validateRegister(registerOf(rows)).findings.some((f) => f.rule === 'esa.806' && f.template === 'B_99.01')).toBe(true);
  });

  it('keys are compared exactly, so trailing spaces break a reference', () => {
    const rows = exampleRows();
    const c = rows.get('B_03.01')?.[0];
    if (c === undefined) throw new Error('no row');
    c.c0010 = 'EX-2025-001 ';
    const rules = validateRegister(registerOf(rows)).findings.filter((f) => f.template === 'B_03.01').map((f) => f.rule);
    expect(rules).toContain('esa.807');
    expect(rules).toContain('roster.whitespace');
  });

  it('skips a reference whose columns are all empty (optional reference such as B_02.01 c0030)', () => {
    const rows = exampleRows();
    expect(rows.get('B_02.01')?.[0]?.c0030).toBeUndefined();
    expect(validateRegister(registerOf(rows)).findings).toEqual([]);
  });
});
