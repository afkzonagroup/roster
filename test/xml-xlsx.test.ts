// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { decodeEntities, escapeXml, parseXml } from '../src/xml/sax.ts';
import { columnIndex, DEFAULT_XLSX_LIMITS, excelSerialToIsoDate, readXlsx } from '../src/xlsx/read.ts';
import { columnLetters, writeXlsx } from '../src/xlsx/write.ts';
import { nodeCodec } from '../src/zip/node-codec.ts';
import { writeZip, type ZipInput } from '../src/zip/write.ts';
import { NOW } from './helpers.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function events(xml: string): string[] {
  const out: string[] = [];
  parseXml(xml, 't', {
    open: (n, a) => {
      out.push(`<${n}${[...a].map(([k, v]) => ` ${k}=${v}`).join('')}>`);
    },
    close: (n) => {
      out.push(`</${n}>`);
    },
    text: (t) => {
      out.push(t);
    },
  });
  return out;
}

describe('XML parser', () => {
  it('parses elements, attributes, text, CDATA, comments and processing instructions', () => {
    expect(events('<?xml version="1.0"?><!-- c --><r a="1" x:b=\'2\'><t>a&amp;b&#65;&#x42;</t><![CDATA[<raw>]]><e/></r>')).toEqual([
      '<r a=1 b=2>', '<t>', 'a&bAB', '</t>', '<raw>', '<e>', '</e>', '</r>',
    ]);
    expect(escapeXml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;');
  });

  it('rejects any document type declaration: no XXE, no entity expansion', () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>';
    expect(() => { parseXml(xxe, 't', {}); }).toThrow(/document type declarations are not allowed/);
    const laughs = '<!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><l>&b;</l>';
    expect(() => { parseXml(laughs, 't', {}); }).toThrow(/document type declarations/);
    expect(() => { decodeEntities('&x;', 't'); }).toThrow(/unsupported entity/);
    expect(() => { decodeEntities('&#0;', 't'); }).toThrow(/unsupported entity/);
    expect(() => { decodeEntities('&#xD800;', 't'); }).toThrow(/unsupported entity/);
  });

  it('rejects malformed XML', () => {
    for (const bad of ['<a><b></a>', '<a>', 'text<a/>', '<a/><b/>', '<a b="1" b="2"/>', '<a b=1/>', '', '<a><!-- x</a>', '<a <b/>', '<a b="<"/>']) {
      expect(() => {
        parseXml(bad, 't', {});
      }, bad).toThrow();
    }
  });

  it('limits depth, element count and attributes', () => {
    expect(() => { parseXml('<a><a><a></a></a></a>', 't', {}, { maxDepth: 2, maxElements: 100, maxAttributes: 5 }); }).toThrow(/deeper than 2/);
    expect(() => { parseXml('<a><b/><b/><b/></a>', 't', {}, { maxDepth: 5, maxElements: 3, maxAttributes: 5 }); }).toThrow(/more than 3 elements/);
    expect(() => { parseXml('<a x="1" y="2"/>', 't', {}, { maxDepth: 5, maxElements: 3, maxAttributes: 1 }); }).toThrow(/too many attributes/);
  });
});

/** Writes a workbook from raw parts, for hostile cases. */
async function rawWorkbook(sheetXml: string, extra: ZipInput[] = [], rels?: string): Promise<Uint8Array> {
  const parts: ZipInput[] = [
    { name: '_rels/.rels', data: enc('<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: enc('<workbook><workbookPr date1904="0"/><sheets><sheet name="B_01.01" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(rels ?? '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc(sheetXml) },
    ...extra,
  ];
  return writeZip(parts, nodeCodec, NOW);
}

describe('XLSX reader', () => {
  it('reads what the writer writes', async () => {
    const bytes = await writeXlsx([{ name: 'B_01.01', rows: [['c0010', 'c0020'], ['A & <b>', ''], ['', 'x']] }, { name: 'Notes', rows: [['n']] }], nodeCodec, NOW);
    const wb = await readXlsx(bytes, nodeCodec);
    expect(wb.sheets.map((s) => s.name)).toEqual(['B_01.01', 'Notes']);
    const s = wb.sheets[0];
    expect(s?.rows.get(2)?.get(1)?.text).toBe('A & <b>');
    expect(s?.rows.get(2)?.has(2)).toBe(false);
    expect(s?.rows.get(3)?.get(2)?.text).toBe('x');
  });

  it('reads shared strings (ignoring phonetic runs), numbers, booleans, errors and formulas without running them', async () => {
    const sst = '<sst><si><t>plain</t></si><si><r><t>rich </t></r><r><t>text</t></r><rPh><t>PHONETIC</t></rPh></si></sst>';
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>12.5</v></c><c r="D1" t="b"><v>1</v></c><c r="E1" t="e"><v>#REF!</v></c>' +
      '<c r="F1"><f>SUM(A1:B1)</f><v>3</v></c><c r="G1" t="str"><f>"=cmd|\' /C calc\'!A0"</f><v>cached</v></c></row></sheetData></worksheet>';
    const wb = await readXlsx(await rawWorkbook(sheet, [{ name: 'xl/sharedStrings.xml', data: enc(sst) }]), nodeCodec);
    const row = wb.sheets[0]?.rows.get(1);
    expect(row?.get(1)).toEqual({ kind: 'string', text: 'plain', formula: false });
    expect(row?.get(2)?.text).toBe('rich text');
    expect(row?.get(3)).toEqual({ kind: 'number', text: '12.5', formula: false });
    expect(row?.get(4)?.text).toBe('TRUE');
    expect(row?.get(5)?.kind).toBe('error');
    expect(row?.get(6)).toEqual({ kind: 'number', text: '3', formula: true });
    expect(row?.get(7)).toEqual({ kind: 'string', text: 'cached', formula: true });
  });

  it('refuses XML entity attacks inside a worksheet', async () => {
    const sheet = '<?xml version="1.0"?><!DOCTYPE w [<!ENTITY x SYSTEM "file:///etc/passwd">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&x;</t></is></c></row></sheetData></worksheet>';
    await expect(readXlsx(await rawWorkbook(sheet), nodeCodec)).rejects.toThrow(/document type declarations are not allowed/);
  });

  it('does not follow relationships out of the package and skips external targets', async () => {
    const outside = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../../../etc/passwd"/></Relationships>';
    await expect(readXlsx(await rawWorkbook('<worksheet/>', [], outside), nodeCodec)).rejects.toThrow(/outside the package/);
    const external = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="https://example.com/x.xml" TargetMode="External"/></Relationships>';
    const wb = await readXlsx(await rawWorkbook('<worksheet/>', [], external), nodeCodec);
    expect(wb.sheets).toEqual([]);
  });

  it('enforces row, column, cell, string and sheet limits (huge sheets)', async () => {
    const rows = Array.from({ length: 50 }, (_x, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>1</v></c></row>`).join('');
    const bytes = await rawWorkbook(`<worksheet><sheetData>${rows}</sheetData></worksheet>`);
    await expect(readXlsx(bytes, nodeCodec, { ...DEFAULT_XLSX_LIMITS, maxRows: 10 })).rejects.toThrow(/more than 10 rows/);
    await expect(readXlsx(bytes, nodeCodec, { ...DEFAULT_XLSX_LIMITS, maxCells: 10 })).rejects.toThrow(/more than 10 cells/);
    const far = await rawWorkbook('<worksheet><sheetData><row r="1"><c r="ZZZ1"><v>1</v></c></row></sheetData></worksheet>');
    await expect(readXlsx(far, nodeCodec, { ...DEFAULT_XLSX_LIMITS, maxColumns: 100 })).rejects.toThrow(/beyond column 100/);
    const long = await rawWorkbook(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(50)}</t></is></c></row></sheetData></worksheet>`);
    await expect(readXlsx(long, nodeCodec, { ...DEFAULT_XLSX_LIMITS, maxCellLength: 10 })).rejects.toThrow(/longer than 10/);
    const sst = `<sst>${'<si><t>s</t></si>'.repeat(20)}<si><t>${'y'.repeat(50)}</t></si></sst>`;
    const shared = await rawWorkbook('<worksheet/>', [{ name: 'xl/sharedStrings.xml', data: enc(sst) }]);
    await expect(readXlsx(shared, nodeCodec, { ...DEFAULT_XLSX_LIMITS, maxSharedStrings: 10 })).rejects.toThrow(/more than 10 shared strings/i);
    await expect(readXlsx(shared, nodeCodec, { ...DEFAULT_XLSX_LIMITS, maxCellLength: 10 })).rejects.toThrow(/text value is longer than 10/);
    const sheets = await writeXlsx([{ name: 'a', rows: [] }, { name: 'b', rows: [] }], nodeCodec, NOW);
    await expect(readXlsx(sheets, nodeCodec, { ...DEFAULT_XLSX_LIMITS, maxSheets: 1 })).rejects.toThrow(/more than 1 worksheets/);
  });

  it('rejects a zip bomb disguised as a workbook', async () => {
    const huge = '<worksheet><sheetData>' + ' '.repeat(5_000_000) + '</sheetData></worksheet>';
    const bytes = await rawWorkbook(huge);
    await expect(readXlsx(bytes, nodeCodec)).rejects.toThrow(/compression ratio/);
  });

  it('rejects files that are not workbooks', async () => {
    await expect(readXlsx(await writeZip([{ name: 'x.txt', data: enc('x') }], nodeCodec, NOW), nodeCodec)).rejects.toThrow(/not an Excel workbook/);
    await expect(readXlsx(await rawWorkbook('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>9</v></c></row></sheetData></worksheet>'), nodeCodec)).rejects.toThrow(/missing shared string/);
  });

  it('converts Excel serial dates in both date systems', () => {
    expect(excelSerialToIsoDate(1, false)).toBe('1900-01-01');
    expect(excelSerialToIsoDate(59, false)).toBe('1900-02-28');
    expect(excelSerialToIsoDate(60, false)).toBeUndefined();
    expect(excelSerialToIsoDate(61, false)).toBe('1900-03-01');
    expect(excelSerialToIsoDate(45657, false)).toBe('2024-12-31');
    expect(excelSerialToIsoDate(2958465, false)).toBe('9999-12-31');
    expect(excelSerialToIsoDate(2958466, false)).toBeUndefined();
    expect(excelSerialToIsoDate(0, true)).toBe('1904-01-01');
    expect(excelSerialToIsoDate(44195, true)).toBe('2024-12-31');
    expect(excelSerialToIsoDate(1.5, false)).toBeUndefined();
    expect(excelSerialToIsoDate(-1, true)).toBeUndefined();
  });

  it('converts column letters both ways', () => {
    for (const [i, l] of [[1, 'A'], [26, 'Z'], [27, 'AA'], [702, 'ZZ'], [703, 'AAA'], [16384, 'XFD']] as [number, string][]) {
      expect(columnLetters(i)).toBe(l);
      expect(columnIndex(l)).toBe(i);
    }
  });

  it('refuses invalid sheet names when writing', async () => {
    await expect(writeXlsx([{ name: 'a/b', rows: [] }], nodeCodec, NOW)).rejects.toThrow(/Invalid worksheet name/);
  });
});
