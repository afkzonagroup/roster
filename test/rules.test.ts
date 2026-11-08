// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The EBA validation rules of the DORA framework: every official expression
// parses; every active rule passes on the valid example and fails on a row
// built to break it.

import { describe, expect, it } from 'vitest';
import { exampleRegister } from '../src/example.ts';
import { DORA_4_0 } from '../src/taxonomy/dora.ts';
import { parseDpmXl, type DpmNode } from '../src/validate/dpmxl.ts';
import { checkEvaluable, evaluateRule } from '../src/validate/evaluate.ts';
import { validateRegister } from '../src/validate/register.ts';
import { changed, first, exampleRows, registerOf } from './helpers.ts';

const template = (code: string) => {
  const t = DORA_4_0.templates.find((x) => x.code === code);
  if (t === undefined) throw new Error(code);
  return t;
};

function failures(register: ReturnType<typeof registerOf>, code: string, includeInactive = false): number {
  return validateRegister(register, { includeInactiveRules: includeInactive }).findings.filter((f) => f.rule === code).length;
}

/** For rules "if ... then not isnull({cX}) endif": the column cX. */
function requiredColumn(n: DpmNode): string | undefined {
  if (n.kind === 'if' && n.then.kind === 'not' && n.then.arg.kind === 'isnull' && n.then.arg.arg.kind === 'select' && Array.isArray(n.then.arg.arg.columns)) {
    const cols: readonly string[] = n.then.arg.arg.columns;
    return cols.length === 1 ? cols[0] : undefined;
  }
  return undefined;
}

describe('DPM-XL parser', () => {
  it.each(DORA_4_0.rules.map((r) => [r.code, r.expression] as const))('parses %s', (_code, expression) => {
    const p = parseDpmXl(expression);
    expect(p.ok).toBe(true);
  });

  it('reports expressions outside the supported subset instead of guessing', () => {
    for (const bad of ['sum({c0010})', 'with {tB_01.01, default: 7}: {c0010} = 1', '{c0010} +', 'if {c0010} then', 'match({c0010}, 5)', '{c0010', '[eba_X:1] # 2', 'with {x}: {c0010}', 'with {tB_01.01, interval: true}: {c0010} = 1']) {
      const p = parseDpmXl(bad);
      expect(p.ok, bad).toBe(false);
    }
  });

  it('marks rules on unknown columns or dimensions as not evaluable', () => {
    const p = parseDpmXl('match({tB_02.02, c0040}[get LES], "^[A-Z]$")');
    if (!p.ok) throw new Error(p.reason);
    expect(checkEvaluable(p.rule, template('B_02.02'))).toMatch(/dimension LES is not a key/);
    const q = parseDpmXl('{c9990} = 1');
    if (!q.ok) throw new Error(q.reason);
    expect(checkEvaluable(q.rule, template('B_01.01'))).toMatch(/column c9990/);
  });
});

describe('official rules on the example register', () => {
  it('every active rule runs and passes', () => {
    const r = validateRegister(exampleRegister());
    expect(r.rulesRun).toHaveLength(DORA_4_0.rules.filter((x) => x.active).length);
    expect(r.findings).toEqual([]);
  });

  it('deactivated rules are listed as not run, unless asked for', () => {
    const r = validateRegister(exampleRegister());
    const inactive = DORA_4_0.rules.filter((x) => !x.active).map((x) => x.code);
    for (const code of inactive) expect(r.notEvaluated.some((n) => n.rule === code && /deactivated/.test(n.reason))).toBe(true);
    const all = validateRegister(exampleRegister(), { includeInactiveRules: true });
    expect(all.rulesRun.length).toBeGreaterThan(r.rulesRun.length);
  });

  it('rules apply only within their reference dates', () => {
    const r = validateRegister(exampleRegister(), { referenceDate: '2024-12-31' });
    expect(r.rulesRun).toEqual([]);
    expect(r.notEvaluated.some((n) => /does not apply to reference date 2024-12-31/.test(n.reason))).toBe(true);
  });
});

const completeness = DORA_4_0.rules.flatMap((r) => {
  const p = parseDpmXl(r.expression);
  const col = p.ok ? requiredColumn(p.rule.expr) : undefined;
  return col !== undefined && r.tables[0] !== undefined && /isnull/.test(r.expression) && !/\[eba_/.test(r.expression) ? [[r.code, r.tables[0], col, r.active] as const] : [];
});

describe('completeness rules ("if any column is reported then cX is reported")', () => {
  it('cover the rules of this shape', () => {
    expect(completeness.length).toBeGreaterThanOrEqual(35);
  });

  it.each(completeness)('%s fails on %s when %s is empty', (code, table, col, active) => {
    const reg = changed((rows) => {
      const list = rows.get(table) ?? [];
      if (list.length === 0) {
        // Templates without example rows: build one from the other columns.
        const row: Record<string, string> = {};
        for (const c of template(table).columns) if (!c.key) row[c.code] = 'x';
        list.push(row);
        rows.set(table, list);
      }
      const row = list[0];
      if (row === undefined) throw new Error('no row');
      Reflect.deleteProperty(row, col);
    });
    expect(failures(reg, code, !active)).toBeGreaterThan(0);
  });
});

describe('other official rules, broken on purpose', () => {
  it('v8826_m: B_01.02 c0060 must look like an LEI', () => {
    expect(failures(changed((r) => (first(r, 'B_01.02').c0060 = 'not-an-lei')), 'v8826_m')).toBe(1);
  });

  it('v8890_m, v8891_m: the key LEI of B_01.01 and B_01.02 (via [get ERI] / [get ESI])', () => {
    expect(failures(changed((r) => (first(r, 'B_01.01').c0010 = 'lowercase0000000000a')), 'v8890_m')).toBe(1);
    expect(failures(changed((r) => (first(r, 'B_01.02').c0010 = 'X')), 'v8891_m')).toBe(1);
  });

  it('v8803_m: total assets need a currency', () => {
    expect(failures(changed((r) => delete first(r, 'B_01.02').c0100), 'v8803_m')).toBe(1);
  });

  it('v8804_m: financial entities report total assets; non-financial entities need not', () => {
    expect(failures(changed((r) => delete first(r, 'B_01.02').c0110), 'v8804_m')).toBe(1);
    expect(
      failures(
        changed((r) => {
          const row = first(r, 'B_01.02');
          delete row.c0110;
          row.c0040 = 'eba_CT:x318';
        }),
        'v8804_m',
      ),
    ).toBe(0);
  });

  it('v8805_m: a subsequent arrangement names its overarching arrangement', () => {
    expect(failures(changed((r) => (first(r, 'B_02.01').c0020 = 'eba_CO:x3')), 'v8805_m')).toBe(1);
    expect(
      failures(
        changed((r) => {
          const row = first(r, 'B_02.01');
          row.c0020 = 'eba_CO:x3';
          row.c0030 = 'EX-2025-002';
        }),
        'v8805_m',
      ),
    ).toBe(0);
  });

  it('v8825_m: not substitutable needs a reason', () => {
    expect(failures(changed((r) => delete first(r, 'B_07.01').c0060), 'v8825_m')).toBe(1);
    expect(
      failures(
        changed((r) => {
          const row = first(r, 'B_07.01');
          delete row.c0060;
          row.c0050 = 'eba_ZZ:x962';
        }),
        'v8825_m',
      ),
    ).toBe(0);
  });

  it('v22913_s, v23716_s: amounts are not negative', () => {
    expect(failures(changed((r) => (first(r, 'B_01.02').c0110 = '-1')), 'v22913_s')).toBe(1);
    expect(failures(changed((r) => (first(r, 'B_02.01').c0050 = '-0.5')), 'v23716_s')).toBe(1);
    expect(failures(changed((r) => (first(r, 'B_02.01').c0050 = '0')), 'v23716_s')).toBe(0);
  });

  it('deactivated rules run with includeInactiveRules: v8816_m end date after start date, e23683_e existence', () => {
    const reg = changed((r) => (first(r, 'B_02.02').c0080 = '2024-01-01'));
    expect(failures(reg, 'v8816_m')).toBe(0);
    expect(failures(reg, 'v8816_m', true)).toBe(1);
    const noNature = changed((r) => delete first(r, 'B_04.01').c0030);
    expect(failures(noNature, 'e23683_e', true)).toBe(1);
    const e = changed((r) => {
      const row = first(r, 'B_05.01');
      delete row.c0050;
      delete row.c0060;
    });
    // Existence rule over several columns: one finding per empty column.
    expect(failures(e, 'e23674_e', true)).toBe(2);
  });

  it('v8817_m (deactivated): legal persons use LEI or EUID; "in" over a member set', () => {
    expect(failures(changed((r) => (first(r, 'B_05.01').c0020 = 'eba_qCO:qx2003')), 'v8817_m', true)).toBe(1);
  });

  it('evaluates three-valued logic: a rule fails only on a definite false', () => {
    const p = parseDpmXl('with {tB_02.02, default: null, interval: false}: {c0080} > {c0070}');
    if (!p.ok) throw new Error(p.reason);
    expect(evaluateRule(p.rule, template('B_02.02'), { c0070: '2025-01-01' }, false)).toEqual([]);
    expect(evaluateRule(p.rule, template('B_02.02'), { c0070: '2025-01-01', c0080: '2024-01-01' }, false)).toEqual([{ column: null }]);
    const q = parseDpmXl('with {tB_02.01, default: 0, interval: false}: {c0050} >= 0');
    if (!q.ok) throw new Error(q.reason);
    expect(evaluateRule(q.rule, template('B_02.01'), { c0020: 'eba_CO:x1' }, false)).toEqual([]);
    const s = parseDpmXl('{c0010} = "null" or {c0010} != "x" and not ({c0020} = 1)');
    if (!s.ok) throw new Error(s.reason);
    expect(evaluateRule(s.rule, template('B_01.01'), { c0010: 'x', c0020: '1' }, false)).toEqual([{ column: null }]);
    const e = parseDpmXl('if {c0020} = 1 then {c0030} = 2 else {c0030} = 3 endif');
    if (!e.ok) throw new Error(e.reason);
    expect(evaluateRule(e.rule, template('B_01.01'), { c0020: '2', c0030: '3' }, false)).toEqual([]);
    expect(evaluateRule(e.rule, template('B_01.01'), { c0020: '2', c0030: '2' }, false)).toEqual([{ column: null }]);
  });

  it('accepts patterns from the rule data only from a safe character set', () => {
    const p = parseDpmXl('match({c0020}, "^(?<x>a)$")');
    if (!p.ok) throw new Error(p.reason);
    // The pattern is refused, so the rule cannot fail (and never compiles an unexpected expression).
    expect(evaluateRule(p.rule, template('B_01.01'), { c0020: 'zzz' }, false)).toEqual([]);
    const nested = parseDpmXl('match({c0020}, "^(a+)+$")');
    if (!nested.ok) throw new Error(nested.reason);
    const start = Date.now();
    expect(evaluateRule(nested.rule, template('B_01.01'), { c0020: `${'a'.repeat(40)}!` }, false)).toEqual([]);
    expect(Date.now() - start).toBeLessThan(1000);
    const q = parseDpmXl('match({c0020}, "^a$")');
    if (!q.ok) throw new Error(q.reason);
    expect(evaluateRule(q.rule, template('B_01.01'), { c0020: 'zzz' }, false)).toEqual([{ column: null }]);
  });

  it('caps the number of findings', () => {
    const rows = exampleRows();
    rows.set('B_06.01', Array.from({ length: 50 }, (_x, i) => ({ c0010: `bad${i}`, c0040: 'x' })));
    const r = validateRegister(registerOf(rows), { maxFindings: 10 });
    expect(r.findings).toHaveLength(10);
    expect(r.truncated).toBeGreaterThan(0);
  });
});
