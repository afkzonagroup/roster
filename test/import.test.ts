// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { importCsvFiles } from '../src/import/csv.ts';
import { expandExponent, normaliseTemplateCode, normaliseValue, parseHeader } from '../src/import/normalize.ts';
import { registerToCsvFiles } from '../src/import/working.ts';
import { importXlsx } from '../src/import/xlsx.ts';
import { exampleRegister } from '../src/example.ts';
import { DORA_4_0, findColumn, findTemplate } from '../src/taxonomy/dora.ts';
import { validateRegister } from '../src/validate/register.ts';
import { writeXlsx } from '../src/xlsx/write.ts';
import { nodeCodec } from '../src/zip/node-codec.ts';
import { writeZip } from '../src/zip/write.ts';
import { NOW, rules } from './helpers.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const col = (t: string, c: string) => {
  const tpl = findTemplate(t);
  const x = tpl === undefined ? undefined : findColumn(tpl, c);
  if (x === undefined) throw new Error(`${t} ${c}`);
  return x;
};

describe('normalisation of spreadsheet entries', () => {
  it('recognises template codes and column headers', () => {
    for (const s of ['B_01.01', 'b_01.01', 'B.01.01', 'b 01 01', 'B0101', 'tB_01.01', ' B_01.01 ']) expect(normaliseTemplateCode(s), s).toBe('B_01.01');
    for (const s of ['RT.01.01', 'B_1.1', 'Instructions']) expect(normaliseTemplateCode(s)).toBeNull();
    expect(parseHeader('c0010', 'B_01.01')).toBe('c0010');
    expect(parseHeader('0010', 'B_01.01')).toBe('c0010');
    expect(parseHeader('B_01.01.0010', 'B_01.01')).toBe('c0010');
    expect(parseHeader('b_01.01.C0020', 'B_01.01')).toBe('c0020');
    expect(parseHeader('B_02.01.0010', 'B_01.01')).toEqual({ error: 'header "B_02.01.0010" belongs to another template' });
    expect(parseHeader('Name', 'B_01.01')).toBeNull();
  });

  it('turns labels, ISO codes and abbreviations into taxonomy codes when unambiguous', () => {
    expect(normaliseValue(col('B_01.01', 'c0030'), 'LU', DORA_4_0).value).toBe('eba_GA:LU');
    expect(normaliseValue(col('B_01.01', 'c0030'), 'Luxembourg', DORA_4_0).value).toBe('eba_GA:LU');
    expect(normaliseValue(col('B_01.01', 'c0030'), 'GA:LU', DORA_4_0).value).toBe('eba_GA:LU');
    expect(normaliseValue(col('B_01.02', 'c0100'), 'EUR', DORA_4_0).value).toBe('eba_CU:EUR');
    expect(normaliseValue(col('B_01.01', 'c0040'), 'credit institutions', DORA_4_0).value).toBe('eba_CT:x12');
    expect(normaliseValue(col('B_05.01', 'c0020'), 'LEI', DORA_4_0).value).toBe('eba_qCO:qx2000');
    expect(normaliseValue(col('B_05.01', 'c0020'), 'EUID', DORA_4_0).value).toBe('eba_qCO:qx2002');
    expect(normaliseValue(col('B_02.02', 'c0140'), 'Yes', DORA_4_0).value).toBe('eba_BT:x28');
    expect(normaliseValue(col('B_02.02', 'c0130'), 'Not applicable', DORA_4_0).value).toBe('eba_GA:qx2007');
    // "Low" means different codes in different columns but one code per column.
    expect(normaliseValue(col('B_02.02', 'c0170'), 'low', DORA_4_0).value).toBe('eba_ZZ:x791');
    expect(normaliseValue(col('B_01.01', 'c0030'), 'Atlantis', DORA_4_0)).toEqual({ value: 'Atlantis', conversion: 'none' });
    expect(normaliseValue(col('B_02.03', 'c0030'), 'TRUE', DORA_4_0).value).toBe('true');
    expect(normaliseValue(col('B_01.01', 'c0020'), 'LU', DORA_4_0)).toEqual({ value: 'LU', conversion: 'none' });
  });

  it('expands scientific notation exactly', () => {
    expect(expandExponent('1.5E+3')).toBe('1500');
    expect(expandExponent('1.23456789012345E+20')).toBe('123456789012345000000');
    expect(expandExponent('2.5E-3')).toBe('0.0025');
    expect(expandExponent('-4E2')).toBe('-400');
    expect(expandExponent('120')).toBeNull();
    expect(normaliseValue(col('B_02.01', 'c0050'), '1.2E5', DORA_4_0).value).toBe('120000');
  });
});

describe('CSV import', () => {
  it('reads the working CSV files back into the same register', () => {
    const files = registerToCsvFiles(exampleRegister());
    const r = importCsvFiles(files);
    expect(r.findings).toEqual([]);
    for (const [code, table] of exampleRegister().tables) {
      expect(r.register.tables.get(code)?.rows.map((x) => x.values)).toEqual(table.rows.map((x) => x.values));
    }
  });

  it('accepts other header forms, a BOM and labels, and reports conversions', () => {
    const r = importCsvFiles([{ name: 'B_01.01.csv', bytes: enc('\ufeffB_01.01.0010,0020,c0030\r\n506700GE1G29325QX363,"Name, Inc.",Luxembourg\r\n\r\n') }]);
    expect(r.register.tables.get('B_01.01')?.rows[0]?.values).toEqual({ c0010: '506700GE1G29325QX363', c0020: 'Name, Inc.', c0030: 'eba_GA:LU' });
    expect(rules(r.findings)).toEqual(['import.converted']);
  });

  it('removes the apostrophe that protects formula-like values', () => {
    const files = registerToCsvFiles(exampleRegister());
    const text = new TextDecoder().decode(files.find((f) => f.name === 'b_05.01.csv')?.bytes).replace('Example Cloud Services Limited,', "'=1+1,");
    const r = importCsvFiles([{ name: 'b_05.01.csv', bytes: enc(text) }]);
    expect(r.register.tables.get('B_05.01')?.rows.some((x) => x.values.c0050 === '=1+1')).toBe(true);
  });

  it('reports bad headers, duplicate columns, extra fields, encoding and structure errors', () => {
    const cases: [string, string, string][] = [
      ['b_01.01.csv', 'c0010,Name\n', 'esa.801'],
      ['b_01.01.csv', 'c0010,c0010\n', 'esa.802'],
      ['b_01.01.csv', 'c0010\na,b\n', 'esa.809'],
      ['b_01.01.csv', 'c0010\n"open\n', 'esa.809'],
      ['b_06.01.csv', 'c0010,B_06.01.0110\n', 'esa.801'],
      ['notes.csv', 'x\n', 'esa.720'],
    ];
    for (const [name, text, rule] of cases) expect(rules(importCsvFiles([{ name, bytes: enc(text) }]).findings), text).toContain(rule);
    expect(rules(importCsvFiles([{ name: 'b_01.01.csv', bytes: new Uint8Array([0x63, 0xff, 0xfe]) }]).findings)).toContain('esa.306');
    expect(importCsvFiles([{ name: 'b_06.01.csv', bytes: enc('c0010,0110\n') }]).findings[0]?.message).toMatch(/FAQ 46/);
    expect(rules(importCsvFiles([{ name: 'b_01.01.csv', bytes: enc('c0010\n') }, { name: 'B_01.01.csv', bytes: enc('c0010\n') }]).findings)).toContain('import.duplicate-template');
    expect(rules(importCsvFiles([{ name: 'b_01.01.csv', bytes: enc('c0010\nx\n') }], { maxFileBytes: 4 }).findings)).toContain('import.too-large');
    expect(importCsvFiles([{ name: 'parameters.csv', bytes: enc('name,value\n') }]).findings).toEqual([]);
  });

  it('in report package mode applies xBRL-CSV special values and does not convert', () => {
    const r = importCsvFiles([{ name: 'b_01.01.csv', bytes: enc('c0010,c0020,c0030\n506700GE1G29325QX363,##hash,LU\nX,#nil,eba_GA:LU\nY,#empty,\nZ,#other,\n') }], { reportPackage: true });
    const rows = r.register.tables.get('B_01.01')?.rows ?? [];
    expect(rows[0]?.values).toEqual({ c0010: '506700GE1G29325QX363', c0020: '#hash', c0030: 'LU' });
    expect(rules(r.findings)).toEqual(['eba-fr.2.19', 'xbrl-csv.special-value']);
    expect(rules(importCsvFiles([{ name: 'b_01.01.csv', bytes: enc('0010\n') }], { reportPackage: true }).findings)).toContain('esa.801');
  });

  it('in report package mode rejects empty header cells and rows with another number of fields', () => {
    const pkg = (text: string): string[] => rules(importCsvFiles([{ name: 'b_01.01.csv', bytes: enc(text) }], { reportPackage: true }).findings);
    expect(pkg('c0010,c0020,\r\nA,B,\r\n')).toEqual(['esa.801']);
    expect(pkg('c0010,c0020\r\nA\r\n')).toEqual(['esa.809']);
    expect(pkg('c0010,c0020\r\nA,B,\r\n')).toEqual(['esa.809']);
    // An empty file and a header without rows are valid (ESAs: nothing to report).
    expect(pkg('')).toEqual([]);
    expect(pkg('\r\n')).toEqual([]);
    expect(pkg('c0010,c0020\r\n')).toEqual([]);
    // Outside report packages, short rows stay accepted (working files).
    expect(rules(importCsvFiles([{ name: 'b_01.01.csv', bytes: enc('c0010,c0020\nA\n') }]).findings)).not.toContain('esa.809');
  });
});

async function workbook(sheets: { name: string; rows: string[][] }[]): Promise<Uint8Array> {
  return writeXlsx(sheets, nodeCodec, NOW);
}

describe('Excel import', () => {
  it('reads the init workbook layout: codes, a row of column names, data', async () => {
    const t = findTemplate('B_01.01');
    if (t === undefined) throw new Error('t');
    const codes = t.columns.map((c) => c.code);
    const names = t.columns.map((c) => c.its?.name ?? c.label);
    const ex = exampleRegister().tables.get('B_01.01')?.rows[0]?.values ?? {};
    const bytes = await workbook([{ name: 'Instructions', rows: [['Fill in']] }, { name: 'B_01.01', rows: [['Entity maintaining the register'], codes, names, codes.map((c) => ex[c] ?? '')] }]);
    const r = await importXlsx(bytes, nodeCodec);
    expect(r.register.tables.get('B_01.01')?.rows.map((x) => x.values)).toEqual([ex]);
    expect(rules(r.findings)).toEqual(['import.ignored-sheets']);
  });

  it('accepts sheet name variants, labels and Excel dates; flags draft RT sheets', async () => {
    const wbBytes = await writeZip(
      [
        { name: '_rels/.rels', data: enc('<Relationships><Relationship Id="r" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
        { name: 'xl/workbook.xml', data: enc('<workbook><sheets><sheet name="B.01.01" r:id="a"/><sheet name="RT.01.02" r:id="b"/></sheets></workbook>') },
        { name: 'xl/_rels/workbook.xml.rels', data: enc('<Relationships><Relationship Id="a" Type="x/worksheet" Target="s1.xml"/><Relationship Id="b" Type="x/worksheet" Target="s2.xml"/></Relationships>') },
        { name: 'xl/s1.xml', data: enc('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>c0010</t></is></c><c r="B1" t="inlineStr"><is><t>c0060</t></is></c><c r="C1" t="inlineStr"><is><t>c0030</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>506700GE1G29325QX363</t></is></c><c r="B2"><v>45657</v></c><c r="C2" t="inlineStr"><is><t>Luxembourg</t></is></c></row></sheetData></worksheet>') },
        { name: 'xl/s2.xml', data: enc('<worksheet/>') },
      ],
      nodeCodec,
      NOW,
    );
    const r = await importXlsx(wbBytes, nodeCodec);
    expect(r.register.tables.get('B_01.01')?.rows[0]?.values).toEqual({ c0010: '506700GE1G29325QX363', c0060: '2024-12-31', c0030: 'eba_GA:LU' });
    expect(rules(r.findings)).toEqual(['import.converted', 'import.draft-template']);
  });

  it('uses cached formula values with a warning, or rejects them', async () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>c0010</t></is></c><c r="B1" t="inlineStr"><is><t>c0020</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>506700GE1G29325QX363</t></is></c><c r="B2" t="str"><f>A2&amp;"x"</f><v>cached</v></c><c r="C2" t="e"><v>#N/A</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>X</t></is></c><c r="B3" t="e"><v>#REF!</v></c></row></sheetData></worksheet>';
    const bytes = await writeZip(
      [
        { name: 'xl/workbook.xml', data: enc('<workbook><sheets><sheet name="B_01.01" r:id="a"/></sheets></workbook>') },
        { name: 'xl/_rels/workbook.xml.rels', data: enc('<Relationships><Relationship Id="a" Type="x/worksheet" Target="s.xml"/></Relationships>') },
        { name: 'xl/s.xml', data: enc(sheet) },
      ],
      nodeCodec,
      NOW,
    );
    const r = await importXlsx(bytes, nodeCodec);
    expect(r.register.tables.get('B_01.01')?.rows[0]?.values.c0020).toBe('cached');
    expect(rules(r.findings)).toEqual(['import.cell-error', 'import.formula', 'import.outside-columns']);
    const strict = await importXlsx(bytes, nodeCodec, { rejectFormulas: true });
    expect(strict.register.tables.get('B_01.01')?.rows[0]?.values.c0020).toBeUndefined();
    expect(strict.findings.find((f) => f.rule === 'import.formula')?.severity).toBe('error');
  });

  it('needs a header row of column codes', async () => {
    const r = await importXlsx(await workbook([{ name: 'B_01.01', rows: [['LEI', 'Name'], ['x', 'y']] }]), nodeCodec);
    expect(rules(r.findings)).toEqual(['esa.801']);
  });

  it('reads the example register from a workbook and validates it cleanly', async () => {
    const sheets = DORA_4_0.templates.map((t) => {
      const codes = t.columns.filter((c) => c.type !== 't').map((c) => c.code);
      return { name: t.code, rows: [codes, ...(exampleRegister().tables.get(t.code)?.rows ?? []).map((row) => codes.map((c) => row.values[c] ?? ''))] };
    });
    const r = await importXlsx(await workbook(sheets), nodeCodec);
    expect(r.findings).toEqual([]);
    expect(validateRegister(r.register).findings).toEqual([]);
  });
});
