// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPackage, checkRegister } from '../src/api.ts';
import { parseCsv } from '../src/csv/parse.ts';
import { exampleRegister, EXAMPLE_SETTINGS } from '../src/example.ts';
import { makeRegister } from '../src/model/register.ts';
import { creationTimestamp, packageBaseName, parsePackageName } from '../src/package/naming.ts';
import { readReportPackage } from '../src/package/read.ts';
import { checkSettings, settingsFromRegister } from '../src/package/settings.ts';
import { columnOrder, escapeSpecial, REPORT_PACKAGE_JSON, tableCsv, writeReportPackage } from '../src/package/write.ts';
import { DORA_4_0, findTemplate } from '../src/taxonomy/dora.ts';
import { validateRegister } from '../src/validate/register.ts';
import { nodeCodec } from '../src/zip/node-codec.ts';
import { openZip } from '../src/zip/read.ts';
import { writeZip, type ZipInput } from '../src/zip/write.ts';
import { changed, NOW, rules } from './helpers.ts';

const SAMPLE_NAME = 'DUMMYLEI123456789012.CON_FR_DORA010100_DORA_2024-12-31_20241213174803429.zip';
const SAMPLE = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures/eba', SAMPLE_NAME)));
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

async function files(bytes: Uint8Array): Promise<Map<string, string>> {
  const z = openZip(bytes, nodeCodec);
  const out = new Map<string, string>();
  for (const e of z.entries) out.set(e.name, e.isDirectory ? '' : dec(await z.read(e)));
  return out;
}

async function examplePackage() {
  return writeReportPackage(exampleRegister(), EXAMPLE_SETTINGS, nodeCodec, NOW);
}

describe('file naming (EBA filing rules v5.9; ESAs FAQ 24)', () => {
  it('builds and parses ReportSubject_Country_FrameworkCodeModuleVersion_Module_ReferenceDate_CreationTimestamp', () => {
    const base = packageBaseName(DORA_4_0.framework, '506700GE1G29325QX363', 'CON', 'IT', '2025-03-31', new Date('2025-04-21T14:16:32Z'));
    expect(base).toBe('506700GE1G29325QX363.CON_IT_DORA010100_DORA_2025-03-31_20250421141632000');
    expect(parsePackageName(base)).toMatchObject({ lei: '506700GE1G29325QX363', consolidation: 'CON', country: 'IT', frameworkModuleVersion: 'DORA010100', module: 'DORA', referenceDate: '2025-03-31' });
    expect(parsePackageName(SAMPLE_NAME.replace('.zip', ''))?.subject).toBe('DUMMYLEI123456789012.CON');
    expect(parsePackageName('x_y')).toBeNull();
    expect(creationTimestamp(new Date('2026-01-02T03:04:05.006Z'))).toBe('20260102030405006');
  });
});

describe('report package writer', () => {
  it('has the structure of the EBA DORA sample package', async () => {
    const ours = await files((await examplePackage()).bytes);
    const theirs = await files(SAMPLE);
    const strip = (m: Map<string, string>) => [...m.keys()].map((k) => k.slice(k.indexOf('/'))).filter((k) => k !== '/').sort();
    expect(strip(ours)).toEqual(strip(theirs));
    const top = [...ours.keys()][0] ?? '';
    expect(top).toBe('EXAMPLE0PAYMENTS0158.IND_LU_DORA010100_DORA_2025-12-31_20260120100000000/');
    const base = top.slice(0, -1);
    expect(JSON.parse(ours.get(`${base}/META-INF/reportPackage.json`) ?? '')).toEqual(JSON.parse([...theirs].find(([k]) => k.endsWith('META-INF/reportPackage.json'))?.[1] ?? ''));
    expect(ours.get(`${base}/META-INF/reportPackage.json`)).toBe(REPORT_PACKAGE_JSON);
    expect(JSON.parse(ours.get(`${base}/reports/report.json`) ?? '')).toEqual(JSON.parse([...theirs].find(([k]) => k.endsWith('reports/report.json'))?.[1] ?? ''));
    const params = (m: Map<string, string>) => parseCsv([...m].find(([k]) => k.endsWith('parameters.csv'))?.[1] ?? '', 'p').map((r) => r.fields[0]);
    expect(params(ours)).toEqual(params(theirs));
    expect(ours.get(`${base}/reports/parameters.csv`)).toBe(`name,value\r\nentityID,rs:${EXAMPLE_SETTINGS.lei}.IND\r\nrefPeriod,2025-12-31\r\nbaseCurrency,iso4217:EUR\r\ndecimalsInteger,0\r\ndecimalsMonetary,-3\r\n`);
    const fi = parseCsv(ours.get(`${base}/reports/FilingIndicators.csv`) ?? '', 'fi').map((r) => r.fields.join(','));
    expect(fi).toEqual(['templateID,reported', ...DORA_4_0.templates.map((t) => `${t.code},true`)]);
  });

  it('writes key columns first, then the rest by name; sorts rows by key; fills Link columns', () => {
    const t = findTemplate('B_02.02');
    if (t === undefined) throw new Error('t');
    expect(columnOrder(t).slice(0, 8)).toEqual(['c0010', 'c0020', 'c0030', 'c0050', 'c0060', 'c0130', 'c0150', 'c0160']);
    const sc = findTemplate('B_05.02');
    if (sc === undefined) throw new Error('t');
    const csv = tableCsv(sc, [
      { values: { c0010: 'B', c0020: 'eba_TA:S01', c0030: 'X', c0050: '10', c0060: 'X' }, origin: { source: 's', line: 1 } },
      { values: { c0010: 'B', c0020: 'eba_TA:S01', c0030: 'X', c0050: '9', c0060: 'X' }, origin: { source: 's', line: 2 } },
      { values: { c0010: 'A', c0020: 'eba_TA:S01', c0030: 'X', c0050: '1', c0060: 'X' }, origin: { source: 's', line: 3 } },
    ]);
    expect(parseCsv(csv, 'x').map((r) => `${r.fields[0] ?? ''}${r.fields[3] ?? ''}`)).toEqual(['c0010c0050', 'A1', 'B9', 'B10']);
    const link = findTemplate('B_03.01');
    if (link === undefined) throw new Error('t');
    expect(tableCsv(link, [{ values: { c0010: 'A', c0020: 'L' }, origin: { source: 's', line: 1 } }])).toBe('c0010,c0020,c0030\r\nA,L,true\r\n');
    expect(escapeSpecial('#1')).toBe('##1');
    expect(escapeSpecial('a#')).toBe('a#');
  });

  it('round trip: register -> package -> register gives the same values and no findings', async () => {
    const pkg = await examplePackage();
    const back = await readReportPackage(pkg.bytes, pkg.fileName, nodeCodec, { now: NOW });
    expect(back.findings).toEqual([]);
    expect(back.settings).toEqual(EXAMPLE_SETTINGS);
    for (const [code, table] of exampleRegister().tables) {
      const sort = (rows: readonly { values: Readonly<Record<string, string>> }[]) => rows.map((r) => JSON.stringify(Object.entries(r.values).filter(([, v]) => v !== '' && v !== 'true').sort())).sort();
      expect(sort(back.register.tables.get(code)?.rows ?? []), code).toEqual(sort(table.rows));
    }
    expect(checkRegister(back.register, { settings: back.settings, now: NOW }).findings).toEqual([]);
  });

  it('writes infinite decimals as #none and reads them back', async () => {
    const pkg = await writeReportPackage(exampleRegister(), { ...EXAMPLE_SETTINGS, decimalsMonetary: 'INF', decimalsInteger: 'INF' }, nodeCodec, NOW);
    const m = await files(pkg.bytes);
    expect([...m].find(([k]) => k.endsWith('parameters.csv'))?.[1]).toMatch(/decimalsInteger,#none\r\ndecimalsMonetary,#none\r\n$/);
    const back = await readReportPackage(pkg.bytes, pkg.fileName, nodeCodec, { now: NOW });
    expect(back.findings).toEqual([]);
    expect(back.settings).toMatchObject({ decimalsMonetary: 'INF', decimalsInteger: 'INF' });
  });

  it('keeps values starting with # through the package', async () => {
    const reg = changed((r) => {
      const row = r.get('B_05.01')?.[0];
      if (row !== undefined) row.c0050 = '#1 Cloud';
    });
    const pkg = await writeReportPackage(reg, EXAMPLE_SETTINGS, nodeCodec, NOW);
    const back = await readReportPackage(pkg.bytes, pkg.fileName, nodeCodec, { now: NOW });
    expect(back.register.tables.get('B_05.01')?.rows.some((r) => r.values.c0050 === '#1 Cloud')).toBe(true);
    // The EBA rejects any value starting with # (filing rules, xBRL-CSV extra rule 5), so it is an error.
    expect(validateRegister(back.register).findings.map((f) => f.rule)).toContain('eba-fr.csv-special');
    const built = await buildPackage(reg, EXAMPLE_SETTINGS, nodeCodec, { now: NOW });
    expect(built.ok).toBe(false);
  });

  it('buildPackage refuses a register with errors unless forced, and never without valid settings', async () => {
    const bad = changed((r) => {
      const row = r.get('B_03.01')?.[0];
      if (row !== undefined) row.c0010 = 'MISSING';
    });
    const refused = await buildPackage(bad, EXAMPLE_SETTINGS, nodeCodec, { now: NOW });
    expect(refused.ok).toBe(false);
    expect(rules(refused.check.findings)).toContain('esa.807');
    expect((await buildPackage(bad, EXAMPLE_SETTINGS, nodeCodec, { now: NOW, force: true })).ok).toBe(true);
    expect((await buildPackage(exampleRegister(), { ...EXAMPLE_SETTINGS, baseCurrency: 'XXX' }, nodeCodec, { now: NOW, force: true })).ok).toBe(false);
    const empty = await buildPackage(makeRegister(new Map()), EXAMPLE_SETTINGS, nodeCodec, { now: NOW });
    expect(rules(empty.check.findings)).toContain('esa.724');
  });
});

describe('report settings', () => {
  it('take LEI and country from B_01.01 when not given', () => {
    const s = settingsFromRegister(exampleRegister(), { consolidation: 'IND', referenceDate: '2025-12-31', baseCurrency: 'EUR' });
    expect(s).toMatchObject({ lei: EXAMPLE_SETTINGS.lei, country: 'LU', decimalsMonetary: -3, decimalsInteger: 0 });
    expect(checkSettings(s, NOW)).toEqual([]);
  });

  it('are checked (LEI, consolidation, country, dates, currency, decimals)', () => {
    const bad = checkSettings({ lei: 'X', consolidation: 'SUB' as 'CON', country: 'XX', referenceDate: '2026-02-30', baseCurrency: 'EURO', decimalsMonetary: -5, decimalsInteger: 2 }, NOW);
    expect(rules(bad)).toEqual(['eba-fr.2.18', 'esa.105', 'esa.109', 'its.lei', 'roster.settings']);
    expect(rules(checkSettings({ ...EXAMPLE_SETTINGS, referenceDate: '2026-12-31' }, NOW))).toEqual(['esa.111']);
    expect(checkSettings({ ...EXAMPLE_SETTINGS, decimalsMonetary: 'INF', decimalsInteger: 'INF' }, NOW)).toEqual([]);
    expect(rules(checkSettings({}, NOW))).toContain('roster.settings');
  });
});

describe('report package reader (ESAs technical checks)', () => {
  it('accepts the EBA sample package without technical findings', async () => {
    const r = await readReportPackage(SAMPLE, SAMPLE_NAME, nodeCodec, { now: NOW });
    expect(r.findings).toEqual([]);
    expect(r.settings).toMatchObject({ lei: 'DUMMYLEI123456789012', consolidation: 'CON', country: 'FR', referenceDate: '2024-12-31', baseCurrency: 'EUR' });
    expect(r.register.tables.get('B_02.02')?.rows).toHaveLength(2);
  });

  /** Rewrites the example package with one change to its files. */
  async function mutated(fn: (files: Map<string, string>) => void, name?: string): Promise<string[]> {
    const pkg = await examplePackage();
    const m = await files(pkg.bytes);
    fn(m);
    const inputs: ZipInput[] = [...m].map(([n, t]) => (n.endsWith('/') ? { name: n } : { name: n, data: enc(t) }));
    const bytes = await writeZip(inputs, nodeCodec, NOW);
    return rules((await readReportPackage(bytes, name ?? pkg.fileName, nodeCodec, { now: NOW })).findings);
  }
  const key = (m: Map<string, string>, suffix: string): string => [...m.keys()].find((k) => k.endsWith(suffix)) ?? '';

  it.each([
    ['file name extension', (m: Map<string, string>) => m, 'x.rar', 'esa.101'],
    ['file name characters', (m: Map<string, string>) => m, 'a b.zip', 'esa.104'],
    ['file name structure', (m: Map<string, string>) => m, 'report.zip', 'esa.105'],
    ['module', (m: Map<string, string>) => m, `${EXAMPLE_SETTINGS.lei}.IND_LU_COREP040000_COREPOF_2025-12-31_20260120100000000.zip`, 'esa.106'],
    ['future reference date', (m: Map<string, string>) => m, `${EXAMPLE_SETTINGS.lei}.IND_LU_DORA010100_DORA_2027-12-31_20260120100000000.zip`, 'esa.111'],
    ['invalid reference date', (m: Map<string, string>) => m, `${EXAMPLE_SETTINGS.lei}.IND_LU_DORA010100_DORA_2025-13-31_20260120100000000.zip`, 'esa.109'],
  ] as const)('checks the %s', async (_n, fn, name, rule) => {
    expect(await mutated(fn, name)).toContain(rule);
  });

  it.each([
    ['missing report.json', (m: Map<string, string>) => m.delete(key(m, 'report.json')), 'esa.701'],
    ['wrong entry point', (m: Map<string, string>) => m.set(key(m, 'report.json'), '{"documentInfo":{"documentType":"https://xbrl.org/2021/xbrl-csv","extends":["http://www.eba.europa.eu/eu/fr/xbrl/crr/fws/dora/3.5/mod/dora.json"]}}'), 'esa.505'],
    ['taxonomy in report.json', (m: Map<string, string>) => m.set(key(m, 'report.json'), `{"documentInfo":{"documentType":"https://xbrl.org/2021/xbrl-csv","extends":["${DORA_4_0.framework.entryPoint}"],"taxonomy":["x"]}}`), 'eba-fr.1.5'],
    ['report.json not JSON', (m: Map<string, string>) => m.set(key(m, 'report.json'), '{'), 'esa.505'],
    ['missing reportPackage.json', (m: Map<string, string>) => m.delete(key(m, 'reportPackage.json')), 'rp.missingReportPackageJson'],
    ['reportPackage.json version', (m: Map<string, string>) => m.set(key(m, 'reportPackage.json'), '{"documentInfo":{"documentType":"https://xbrl.org/report-package/2099"}}'), 'rp.unsupportedReportPackageVersion'],
    ['reportPackage.json not JSON', (m: Map<string, string>) => m.set(key(m, 'reportPackage.json'), 'x'), 'rp.invalidJSON'],
    ['parameters header', (m: Map<string, string>) => m.set(key(m, 'parameters.csv'), 'key,value\nentityID,x\n'), 'esa.723'],
    ['entityID mismatch', (m: Map<string, string>) => m.set(key(m, 'parameters.csv'), (m.get(key(m, 'parameters.csv')) ?? '').replace('.IND', '.CON')), 'esa.714'],
    ['entityID qualifier', (m: Map<string, string>) => m.set(key(m, 'parameters.csv'), (m.get(key(m, 'parameters.csv')) ?? '').replace(/rs:([A-Z0-9]+)\.IND/, 'lei:$1')), 'esa.514'],
    ['refPeriod mismatch', (m: Map<string, string>) => m.set(key(m, 'parameters.csv'), (m.get(key(m, 'parameters.csv')) ?? '').replace('refPeriod,2025-12-31', 'refPeriod,2025-06-30')), 'esa.320'],
    ['unknown parameter', (m: Map<string, string>) => m.set(key(m, 'parameters.csv'), `${m.get(key(m, 'parameters.csv')) ?? ''}extra,1\r\n`), 'xbrl-csv.unreferencedParameter'],
    ['decimals', (m: Map<string, string>) => m.set(key(m, 'parameters.csv'), (m.get(key(m, 'parameters.csv')) ?? '').replace('decimalsMonetary,-3', 'decimalsMonetary,-6')), 'eba-fr.2.18'],
    ['base currency', (m: Map<string, string>) => m.set(key(m, 'parameters.csv'), (m.get(key(m, 'parameters.csv')) ?? '').replace('iso4217:EUR', 'EUR')), 'roster.settings'],
    ['filing indicator false', (m: Map<string, string>) => m.set(key(m, 'FilingIndicators.csv'), (m.get(key(m, 'FilingIndicators.csv')) ?? '').replace('B_01.03,true', 'B_01.03,false')), 'esa.808'],
    ['filing indicator missing', (m: Map<string, string>) => m.set(key(m, 'FilingIndicators.csv'), (m.get(key(m, 'FilingIndicators.csv')) ?? '').replace('B_01.03,true\r\n', '')), 'eba-fr.1.6'],
    ['filing indicator twice', (m: Map<string, string>) => m.set(key(m, 'FilingIndicators.csv'), `${m.get(key(m, 'FilingIndicators.csv')) ?? ''}B_01.03,true\r\n`), 'esa.703'],
    ['filing indicator boolean', (m: Map<string, string>) => m.set(key(m, 'FilingIndicators.csv'), (m.get(key(m, 'FilingIndicators.csv')) ?? '').replace('B_01.03,true', 'B_01.03,yes')), 'esa.704'],
    ['filing indicator value', (m: Map<string, string>) => m.set(key(m, 'FilingIndicators.csv'), (m.get(key(m, 'FilingIndicators.csv')) ?? '').replace('B_01.03,true', 'B_01.03,')), 'esa.705'],
    ['filing indicator columns', (m: Map<string, string>) => m.set(key(m, 'FilingIndicators.csv'), (m.get(key(m, 'FilingIndicators.csv')) ?? '').replace('B_01.03,true', 'B_01.03,true,x')), 'esa.702'],
    ['filing indicator code', (m: Map<string, string>) => m.set(key(m, 'FilingIndicators.csv'), `${m.get(key(m, 'FilingIndicators.csv')) ?? ''}C_01.00,true\r\n`), 'esa.510'],
    ['unknown table file', (m: Map<string, string>) => m.set(`${key(m, 'report.json').replace('report.json', '')}b_08.01.csv`, 'c0010\n'), 'esa.720'],
    ['nil value', (m: Map<string, string>) => m.set(key(m, 'b_05.01.csv'), (m.get(key(m, 'b_05.01.csv')) ?? '').replace('Example Cloud Services Limited', '#nil')), 'eba-fr.2.19'],
    ['unknown table header', (m: Map<string, string>) => m.set(key(m, 'b_05.01.csv'), '�'), 'esa.801'],
  ] as const)('flags %s', async (_n, fn, rule) => {
    expect(await mutated(fn)).toContain(rule);
  });

  it('rejects archives that are damaged or have no single top-level folder', async () => {
    const pkg = await examplePackage();
    const broken = pkg.bytes.slice(0, pkg.bytes.length - 30);
    expect(rules((await readReportPackage(broken, pkg.fileName, nodeCodec, { now: NOW })).findings)).toContain('esa.103');
    const flat = await writeZip([{ name: 'report.json', data: enc('{}') }], nodeCodec, NOW);
    expect(rules((await readReportPackage(flat, pkg.fileName, nodeCodec, { now: NOW })).findings)).toContain('rp.invalidDirectoryStructure');
    const two = await writeZip([{ name: 'a/x', data: enc('1') }, { name: 'b/y', data: enc('1') }], nodeCodec, NOW);
    expect(rules((await readReportPackage(two, pkg.fileName, nodeCodec, { now: NOW })).findings)).toContain('rp.invalidDirectoryStructure');
    const wrongTop = await mutated((m) => {
      const entries = [...m];
      m.clear();
      for (const [k, v] of entries) m.set(k.replace(/^[^/]+/, 'other'), v);
    });
    expect(wrongTop).toContain('esa.105');
  });

  it('reads a package with non-UTF-8 bytes as an encoding error (306)', async () => {
    const pkg = await examplePackage();
    const m = await files(pkg.bytes);
    const inputs: ZipInput[] = [...m].map(([n, t]) => (n.endsWith('/') ? { name: n } : { name: n, data: n.endsWith('parameters.csv') ? new Uint8Array([0xff, 0xfe, 0x00]) : enc(t) }));
    const r = await readReportPackage(await writeZip(inputs, nodeCodec, NOW), pkg.fileName, nodeCodec, { now: NOW });
    expect(rules(r.findings)).toContain('esa.306');
  });

  it('reports a package without data (724)', async () => {
    const empty = await writeReportPackage(makeRegister(new Map()), EXAMPLE_SETTINGS, nodeCodec, NOW);
    expect(rules((await readReportPackage(empty.bytes, empty.fileName, nodeCodec, { now: NOW })).findings)).toEqual(['esa.724']);
  });
});
