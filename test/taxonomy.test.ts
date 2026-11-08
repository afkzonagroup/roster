// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The generated taxonomy data: complete, consistent with the official files
// it was generated from, and with the facts the code relies on.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DORA_4_0, allowedValues, findColumn, findTemplate, memberLabel } from '../src/taxonomy/dora.ts';

const T = DORA_4_0;

describe('generated DORA taxonomy data', () => {
  it('describes the DORA 4.0 module and its entry point', () => {
    expect(T.framework).toMatchObject({ code: 'DORA', release: '4.0', module: 'dora', moduleVersion: '1.1.0', fromReferenceDate: '2025-03-31', toReferenceDate: null });
    expect(T.framework.entryPoint).toBe('http://www.eba.europa.eu/eu/fr/xbrl/crr/fws/dora/4.0/mod/dora.json');
    expect(T.framework.reportDocumentType).toBe('https://xbrl.org/2021/xbrl-csv');
  });

  it('has the 15 templates of ITS Article 5 and Annex I, in the module order', () => {
    expect(T.templates.map((t) => t.code)).toEqual(['B_01.01', 'B_01.02', 'B_01.03', 'B_02.01', 'B_02.02', 'B_02.03', 'B_03.01', 'B_03.02', 'B_03.03', 'B_04.01', 'B_05.01', 'B_05.02', 'B_06.01', 'B_07.01', 'B_99.01']);
    for (const t of T.templates) {
      expect(t.file).toBe(`${t.code.toLowerCase()}.csv`);
      expect(t.itsName, t.code).not.toBeNull();
    }
  });

  it('gives every column a type, and every key column an entry in the primary key', () => {
    let columns = 0;
    for (const t of T.templates) {
      for (const c of t.columns) {
        columns++;
        expect(['s', 'e', 'd', 'i', 'm', 't'], `${t.code} ${c.code}`).toContain(c.type);
        expect(c.code).toMatch(/^c[0-9]{4}$/);
        if (c.key) expect(t.primaryKey).toContain(c.code);
      }
      for (const k of t.primaryKey) expect(findColumn(t, k)?.key, `${t.code} ${k}`).toBe(true);
    }
    expect(columns).toBe(120);
  });

  it('maps every column except the technical Link columns to its ITS column', () => {
    const unmapped = T.templates.flatMap((t) => t.columns.filter((c) => c.its === null).map((c) => `${t.code} ${c.code}`));
    expect(unmapped).toEqual(['B_02.03 c0030', 'B_03.01 c0030', 'B_03.03 c0031']);
    for (const t of T.templates) for (const c of t.columns) if (c.its === null) expect(c.type).toBe('t');
  });

  it('follows the taxonomy numbering of B_06.01 (ESAs FAQ 46): c0050 is ITS B_06.01.0060', () => {
    const t = findTemplate('B_06.01');
    if (t === undefined) throw new Error('missing');
    expect(t.columns.map((c) => [c.code, c.its?.code])).toEqual([
      ['c0010', 'B_06.01.0010'], ['c0020', 'B_06.01.0020'], ['c0030', 'B_06.01.0030'], ['c0040', 'B_06.01.0040'], ['c0050', 'B_06.01.0060'],
      ['c0060', 'B_06.01.0070'], ['c0070', 'B_06.01.0080'], ['c0080', 'B_06.01.0090'], ['c0090', 'B_06.01.0100'], ['c0100', 'B_06.01.0110'],
    ]);
  });

  it('gives every closed-list column a list and every member an English label', () => {
    for (const t of T.templates) {
      for (const c of t.columns) {
        if (c.type !== 'e') {
          expect(c.enumeration, `${t.code} ${c.code}`).toBeNull();
          continue;
        }
        const values = allowedValues(c);
        expect(values.length, `${t.code} ${c.code}`).toBeGreaterThan(1);
        for (const v of values) {
          expect(v).toMatch(/^eba_[A-Za-z]+:[A-Za-z0-9]+$/);
          expect(memberLabel(v), v).toBeTruthy();
        }
      }
    }
    expect(memberLabel('eba_GA:LU')).toBe('LUXEMBOURG');
    expect(memberLabel('eba_GA:qx2007')).toBe('Not applicable');
    const services = findTemplate('B_02.02')?.columns.find((c) => c.code === 'c0060');
    expect(services === undefined ? [] : allowedValues(services)).toHaveLength(19);
  });

  it('derives the identifier type pairs and LEI columns from the ITS', () => {
    const pairs = T.templates.flatMap((t) => t.columns.filter((c) => c.identifies !== null).map((c) => `${t.code} ${c.code}->${c.identifies ?? ''}`));
    expect(pairs).toEqual(['B_02.02 c0040->c0030', 'B_03.02 c0030->c0020', 'B_05.01 c0020->c0010', 'B_05.01 c0040->c0030', 'B_05.01 c0120->c0110', 'B_05.02 c0040->c0030', 'B_05.02 c0070->c0060', 'B_07.01 c0030->c0020']);
    const lei = T.templates.flatMap((t) => t.columns.filter((c) => c.lei).map((c) => `${t.code} ${c.code}`));
    expect(lei).toEqual(['B_01.01 c0010', 'B_01.02 c0010', 'B_01.02 c0060', 'B_01.03 c0020', 'B_02.02 c0020', 'B_03.01 c0020', 'B_03.03 c0020', 'B_04.01 c0020', 'B_06.01 c0040']);
    expect(findTemplate('B_06.01')?.columns.find((c) => c.code === 'c0060')?.maxLength).toBe(300);
  });

  it('declares 22 reference keys pointing to existing templates of the same width', () => {
    const refs = T.templates.flatMap((t) => t.references.map((r) => ({ t, r })));
    expect(refs).toHaveLength(22);
    for (const { t, r } of refs) {
      const target = findTemplate(r.target);
      expect(target, `${t.code} ${r.name}`).toBeDefined();
      expect(r.columns.length).toBe(target?.primaryKey.length);
    }
  });

  it('has the 71 DORA validation rules of the EBA file, all parsed', () => {
    expect(T.rules).toHaveLength(71);
    expect(T.rules.filter((r) => r.parseError !== null)).toEqual([]);
    expect(T.rules.filter((r) => r.active)).toHaveLength(49);
    expect(new Set(T.rules.map((r) => r.code)).size).toBe(71);
  });

  it('has the ESAs technical checks and the external business checks', () => {
    expect(T.checks).toHaveLength(41);
    expect(T.checks.find((c) => c.code === '807')?.description).toMatch(/key-foreign key/);
    expect(T.externalChecks.map((c) => c.code)).toEqual(['VR_2', 'VR_12', 'VR_16', 'VR_23', 'VR_71', 'VR_72', 'VR_77', 'VR_78']);
  });

  it('records every official source with a SHA-256 that matches scripts/sources.json', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../scripts/sources.json'), 'utf8')) as { sources: { id: string; sha256: string; url: string }[] };
    expect(T.sources.map((s) => s.id)).toEqual(manifest.sources.map((s) => s.id));
    for (const s of T.sources) {
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.url).toMatch(/^https:\/\/(www\.eba\.europa\.eu|publications\.europa\.eu)\//);
      expect(manifest.sources.find((m) => m.id === s.id)?.sha256).toBe(s.sha256);
    }
  });
});
