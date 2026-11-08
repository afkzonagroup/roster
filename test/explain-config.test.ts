// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { allRuleIds, describeRule } from '../src/explain/catalogue.ts';
import { explain, renderExplanation } from '../src/explain/explain.ts';
import { DORA_4_0 } from '../src/taxonomy/dora.ts';
import { validateRegister } from '../src/validate/register.ts';
import { exampleRegister } from '../src/example.ts';

describe('explain', () => {
  it('knows every rule Roster can report and says how it is covered, with a source', () => {
    const ids = allRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const r = describeRule(id);
      expect(r, id).toBeDefined();
      expect(r?.origin.length, id).toBeGreaterThan(5);
      expect(['checked', 'not-checked', 'not-applicable', 'by-construction']).toContain(r?.coverage);
      for (const l of r?.links ?? []) expect(l.url).toMatch(/^https:\/\//);
    }
    expect(describeRule('nope')).toBeUndefined();
    expect(describeRule('esa.999')).toBeUndefined();
  });

  it('every rule id the validator can emit is explained', () => {
    // Rule ids used in the source code.
    const emitted = new Set<string>();
    for (const f of validateRegister(exampleRegister(), { includeInactiveRules: true }).findings) emitted.add(f.rule);
    for (const id of ['its.lei', 'its.euid', 'its.mandatory', 'its.natural-number', 'its.rank', 'its.function-identifier', 'its.max-length', 'xbrl-csv.character', 'roster.whitespace', 'roster.suspicious-character', 'roster.formula-like', 'esa.801', 'esa.805', 'esa.806', 'esa.807', 'esa.503', 'esa.330', 'esa.331', 'esa.305', 'esa.333', 'esa.724', 'esa.105', 'esa.109', 'esa.111', 'eba-fr.2.18', 'roster.settings', 'import.formula', 'import.cell-error', 'import.converted', 'import.draft-template', 'import.ignored-sheets', 'import.outside-columns', 'import.duplicate-template', 'import.too-large', 'eba-fr.2.19', 'xbrl-csv.special-value', 'eba-fr.csv-special', 'rp.invalidDirectoryStructure', 'rp.missingReportPackageJson', 'rp.unsupportedReportPackageVersion', 'rp.invalidJSON', 'rp.missingReportsDirectory', 'eba-fr.1.5', 'eba-fr.1.6', 'xbrl-csv.invalidParameterCSVFile', 'xbrl-csv.unreferencedParameter']) emitted.add(id);
    for (const id of emitted) expect(describeRule(id), id).toBeDefined();
  });

  it('marks the checks Roster cannot run', () => {
    expect(describeRule('VR_71')?.coverage).toBe('not-checked');
    expect(describeRule('VR_71')?.how).toMatch(/GLEIF/);
    expect(describeRule('esa.110')?.coverage).toBe('not-checked');
    expect(describeRule('esa.803')?.coverage).toBe('not-applicable');
    expect(describeRule('esa.512')?.coverage).toBe('by-construction');
    expect(describeRule('v8816_m')?.status).toMatch(/deactivated/);
  });

  it('explains rules, templates and columns (ITS and taxonomy codes)', () => {
    expect(renderExplanation(explain('v8826_m'))).toMatch(/match\(\{tB_01\.02, c0060\}/);
    expect(renderExplanation(explain('ESA.807'))).toMatch(/key-foreign key/);
    const t = renderExplanation(explain('B_02.02'));
    expect(t).toMatch(/b_02\.02\.csv/);
    expect(t).toMatch(/c0050 \+ c0020 -> B_06\.01/);
    const c = renderExplanation(explain('B_06.01.0060'));
    expect(c).toMatch(/B_06\.01 c0050 \(ITS B_06\.01\.0060\): Criticality or importance assessment/);
    expect(c).toMatch(/FAQ question 46/);
    expect(renderExplanation(explain('B_06.01.c0060'))).toMatch(/Reasons for criticality/);
    expect(renderExplanation(explain('B_01.01.0030'))).toMatch(/\.\.\. 211 more/);
    expect(renderExplanation(explain('B_03.01.c0030'))).toMatch(/Link/);
    expect(renderExplanation(explain('B_05.01.0020'))).toMatch(/type of code of c0010/);
    expect(renderExplanation(explain('B_01.01.0010'))).toMatch(/Checked as an LEI/);
    expect(explain('B_09.09').kind).toBe('unknown');
    expect(explain('B_01.01.0990').kind).toBe('unknown');
    expect(renderExplanation(explain('whatever'))).toMatch(/No rule, template or column/);
    expect(DORA_4_0.templates.every((x) => explain(x.code).kind === 'template')).toBe(true);
  });
});

describe('roster.json', () => {
  it('parses known settings', () => {
    expect(parseConfig('{"lei":"X","consolidation":"CON","country":"LU","referenceDate":"2025-12-31","baseCurrency":"EUR","decimalsMonetary":-3,"decimalsInteger":"INF","comment":"x"}')).toEqual({
      lei: 'X', consolidation: 'CON', country: 'LU', referenceDate: '2025-12-31', baseCurrency: 'EUR', decimalsMonetary: -3, decimalsInteger: 'INF',
    });
  });
  it('rejects unknown keys, wrong types and oversized files', () => {
    for (const bad of ['[]', 'null', '{', '{"leii":"x"}', '{"consolidation":"SUB"}', '{"decimalsMonetary":"-3"}', '{"decimalsMonetary":1.5}', '{"lei":5}', `{"lei":"${'x'.repeat(65)}"}`, `{"comment":"${'x'.repeat(70_000)}"}`]) {
      expect(() => parseConfig(bad), bad.slice(0, 30)).toThrow();
    }
  });
});
