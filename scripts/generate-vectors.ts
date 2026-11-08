// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Writes test-vectors/registers.json and test-vectors/identifiers.json: cases
// that the TypeScript and the Python implementations must both pass. Each
// register case is the example register plus a patch; the expected findings
// come from the TypeScript validator. Requires Node >= 22.18.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exampleRegister } from '../src/example.ts';
import { DORA_4_0, allowedValues } from '../src/taxonomy/dora.ts';
import { parseDpmXl } from '../src/validate/dpmxl.ts';
import { checkEuid, checkLei } from '../src/validate/identifiers.ts';
import { applyPatch, expectedFindings, type Patch, type VectorCase } from '../test/vectors-lib.ts';

const ROOT = join(import.meta.dirname, '..');
const cases: VectorCase[] = [];
const add = (name: string, patch: Patch[], options: VectorCase['options'] = {}): void => {
  const c: VectorCase = { name, patch, options, expected: [] };
  cases.push({ ...c, expected: expectedFindings(applyPatch(exampleRegister(), patch), options) });
};

add('example register is clean', []);
add('example register, reporting', [], { reporting: true, referenceDate: '2025-12-31' });

const bad: Record<string, string[]> = { e: ['eba_XX:x1'], d: ['2025-02-30', '31.12.2025'], i: ['1.5'], m: ['1,000', '1e5'], t: ['false'] };
for (const t of DORA_4_0.templates) {
  const hasRow = (exampleRegister().tables.get(t.code)?.rows.length ?? 0) > 0;
  for (const c of t.columns) {
    const row = hasRow ? 0 : -1;
    const keys = hasRow ? [] : t.primaryKey.filter((k) => k !== c.code).map((k) => ({ template: t.code, row: 0, column: k, value: 'K' }));
    for (const v of bad[c.type] ?? []) add(`${t.code} ${c.code} invalid ${v}`, [...(row < 0 ? [{ template: t.code, row: 0, column: c.code, value: v }] : [{ template: t.code, row, column: c.code, value: v }]), ...keys]);
    if (hasRow) add(`${t.code} ${c.code} empty`, [{ template: t.code, row: 0, column: c.code, value: null }], { reporting: true });
    if (c.type === 'e') add(`${t.code} ${c.code} last allowed value`, [{ template: t.code, row: 0, column: c.code, value: allowedValues(c).at(-1) ?? '' }, ...keys]);
  }
  for (const r of t.references) {
    if (hasRow) add(`${t.code} reference ${r.name} broken`, [{ template: t.code, row: 0, column: r.columns[0] ?? '', value: 'NO-SUCH' }]);
  }
}
for (const rule of DORA_4_0.rules) {
  const p = parseDpmXl(rule.expression);
  if (!p.ok) continue;
  const table = rule.tables[0] ?? '';
  const hasRow = (exampleRegister().tables.get(table)?.rows.length ?? 0) > 0;
  if (!hasRow) continue;
  for (const col of new Set(rule.expression.match(/c[0-9]{4}/g) ?? [])) {
    add(`${rule.code} with ${table} ${col} empty`, [{ template: table, row: 0, column: col, value: null }], { includeInactiveRules: true });
  }
}
const specials: [string, Patch[], VectorCase['options']?][] = [
  ['v8826_m LEI format', [{ template: 'B_01.02', row: 0, column: 'c0060', value: 'not-an-lei' }]],
  ['v8890_m key LEI', [{ template: 'B_01.01', row: 0, column: 'c0010', value: 'lowercase0000000000a' }]],
  ['v8805_m subsequent', [{ template: 'B_02.01', row: 0, column: 'c0020', value: 'eba_CO:x3' }]],
  ['v8804_m non-financial', [{ template: 'B_01.02', row: 0, column: 'c0110', value: null }, { template: 'B_01.02', row: 0, column: 'c0040', value: 'eba_CT:x318' }]],
  ['v8825_m reason', [{ template: 'B_07.01', row: 0, column: 'c0060', value: null }]],
  ['v22913_s negative', [{ template: 'B_01.02', row: 0, column: 'c0110', value: '-1' }]],
  ['v23716_s negative', [{ template: 'B_02.01', row: 0, column: 'c0050', value: '-0.5' }]],
  ['v8816_m dates (inactive)', [{ template: 'B_02.02', row: 0, column: 'c0080', value: '2024-01-01' }], { includeInactiveRules: true }],
  ['v8817_m type (inactive)', [{ template: 'B_05.01', row: 0, column: 'c0020', value: 'eba_qCO:qx2003' }], { includeInactiveRules: true }],
  ['rules outside reference date', [{ template: 'B_01.02', row: 0, column: 'c0060', value: 'x' }], { referenceDate: '2024-12-31' }],
  ['LEI check digits', [{ template: 'B_06.01', row: 0, column: 'c0040', value: '506700GE1G29325QX364' }]],
  ['identification code LEI', [{ template: 'B_05.01', row: 0, column: 'c0010', value: 'NOT-AN-LEI' }]],
  ['EUID allowed in B_03.01.0020', [{ template: 'B_03.01', row: 0, column: 'c0020', value: 'LUEXAMPLE.B000001' }]],
  ['identification code EUID', [{ template: 'B_05.01', row: 1, column: 'c0010', value: 'NOEUID' }]],
  ['natural number', [{ template: 'B_02.02', row: 0, column: 'c0100', value: '-5' }]],
  ['rank', [{ template: 'B_05.02', row: 0, column: 'c0050', value: '0' }]],
  ['function identifier', [{ template: 'B_06.01', row: 0, column: 'c0010', value: 'Function 1' }]],
  ['max length', [{ template: 'B_06.01', row: 0, column: 'c0060', value: 'x'.repeat(301) }]],
  ['max length in code points', [{ template: 'B_06.01', row: 0, column: 'c0060', value: '\u{1F600}'.repeat(300) }]],
  ['control character', [{ template: 'B_05.01', row: 0, column: 'c0050', value: 'A\u0001B' }]],
  ['bidi character', [{ template: 'B_05.01', row: 0, column: 'c0050', value: 'A\u202eB' }]],
  ['C1 character', [{ template: 'B_05.01', row: 0, column: 'c0050', value: 'A\u0085B' }]],
  ['whitespace', [{ template: 'B_05.01', row: 0, column: 'c0050', value: ' Name ' }]],
  ['formula-like', [{ template: 'B_05.01', row: 0, column: 'c0050', value: '=1+1' }]],
  ['negative number is not formula-like', [{ template: 'B_05.01', row: 0, column: 'c0050', value: '-12.5' }]],
  ['value starting with #', [{ template: 'B_05.01', row: 0, column: 'c0050', value: '#1 Provider' }]],
  ['line break allowed', [{ template: 'B_05.01', row: 0, column: 'c0050', value: 'A\nB' }]],
  ['duplicate key', [{ template: 'B_05.02', row: 3, column: '*copy', value: '0' }, { template: 'B_05.02', row: 3, column: 'c0050', value: '01' }]],
  ['B_99.01 second row', [{ template: 'B_99.01', row: 1, column: 'c0020', value: 'x' }]],
  ['unknown column', [{ template: 'B_01.01', row: 0, column: 'c9999', value: 'x' }]],
];
for (const [name, patch, options] of specials) add(name, patch, options ?? {});

/** JSON with invisible, bidirectional and C1 characters written as \u escapes, so files stay plain to read. */
const safeJson = (v: unknown): string => JSON.stringify(v, null, 1).replace(/[\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

writeFileSync(join(ROOT, 'test-vectors/registers.json'), `${safeJson({ comment: 'Generated by scripts/generate-vectors.ts. Each case: the example register (examples/register) with a patch, and the findings both implementations must report.', cases })}\n`);

const leis = ['506700GE1G29325QX363', '5493001KJTIIGC8Y1R12', '7LTWFZYICNSX8D621K86', '506700GE1G29325QX364', '506700ge1g29325qx363', 'DUMMYLEI123456789012', '506700GE1G29325QX3', '', 'EXAMPLE0PAYMENTS0158'];
const euids = ['DEK1101R.HRB116737', 'LUEXAMPLE.B000001', 'HRB116737', 'DE.123', 'de123.4', 'DEK1101R.', 'DEK1101R HRB116737', ''];
writeFileSync(
  join(ROOT, 'test-vectors/identifiers.json'),
  `${JSON.stringify({ comment: 'Generated by scripts/generate-vectors.ts.', lei: leis.map((v) => ({ value: v, problem: checkLei(v) })), euid: euids.map((v) => ({ value: v, valid: checkEuid(v) })) }, null, 1)}\n`,
);
process.stdout.write(`${cases.length} register cases\n`);
