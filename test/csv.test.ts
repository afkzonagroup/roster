// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { isBlankRecord, parseCsv } from '../src/csv/parse.ts';
import { csvField, neutraliseFormula, writeCsv, writeSafeCsv } from '../src/csv/write.ts';
import { unneutraliseFormula } from '../src/import/working.ts';

const fields = (text: string): string[][] => parseCsv(text, 't').map((r) => [...r.fields]);

describe('CSV parser (RFC 4180 as amended by xBRL-CSV 1.0, section 3.2.1)', () => {
  it('reads plain and quoted fields with CR, LF and CR LF line endings', () => {
    expect(fields('a,b\r\nc,d\ne,f\rg,h')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']]);
    expect(fields('"a,b","c""d","e\r\nf"\n')).toEqual([['a,b', 'c"d', 'e\r\nf']]);
    expect(fields('"x\ry"')).toEqual([['x\ry']]);
  });

  it('keeps empty fields and records line numbers across quoted line breaks', () => {
    const r = parseCsv('a,,c\n"1\n2",x\nlast', 't');
    expect(r.map((x) => x.line)).toEqual([1, 2, 4]);
    expect(r[0]?.fields).toEqual(['a', '', 'c']);
    expect(isBlankRecord({ line: 1, fields: ['', ''] })).toBe(true);
    expect(fields('')).toEqual([]);
    expect(fields('\n')).toEqual([['']]);
    expect(fields('a,')).toEqual([['a', '']]);
    expect(fields('""')).toEqual([['']]);
  });

  it('rejects malformed quoting with a line number', () => {
    expect(() => parseCsv('a"b', 't')).toThrow(/line 1: a double quote inside an unquoted field/);
    expect(() => parseCsv('ok\n"open', 't')).toThrow(/line 2: a quoted field is not closed/);
    expect(() => parseCsv('"a"b', 't')).toThrow(/text after a closing quote/);
    expect(() => parseCsv('"a" ,b', 't')).toThrow(/text after a closing quote/);
  });

  it('enforces record, field and length limits', () => {
    const limits = { maxRecords: 2, maxFields: 3, maxFieldLength: 5 };
    expect(() => parseCsv('a\nb\nc', 't', limits)).toThrow(/more than 2 records/);
    expect(() => parseCsv('a,b,c,d', 't', limits)).toThrow(/more than 3 fields/);
    expect(() => parseCsv('abcdef', 't', limits)).toThrow(/longer than 5/);
    expect(() => parseCsv('"abcdef"', 't', limits)).toThrow(/longer than 5/);
    expect(() => parseCsv('abcde,abcdef', 't', limits)).toThrow(/longer than 5/);
  });
});

describe('CSV writer', () => {
  it('quotes fields with comma, quote, CR or LF and doubles quotes (EBA filing rules, footnote 27)', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "x"')).toBe('"say ""x"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(writeCsv([['a', 'b,c'], ['', 'd']])).toBe('a,"b,c"\r\n,d\r\n');
  });

  it('round-trips through the parser', () => {
    const rows = [['x', 'y "z"', 'a,b', 'line\r\nbreak', '']];
    expect(fields(writeCsv(rows))).toEqual(rows);
  });

  it('neutralises formula-like values for spreadsheet users and restores them on import', () => {
    for (const v of ['=1+1', '+A1', '-A1', '@SUM(A1)', '\t=x', ' =x', '\uff1dx', '\r=x']) {
      expect(neutraliseFormula(v)).toBe(`'${v}`);
      expect(unneutraliseFormula(neutraliseFormula(v))).toBe(v);
    }
    for (const v of ['-12.5', '42', 'text', "'quoted"]) expect(neutraliseFormula(v)).toBe(v);
    expect(unneutraliseFormula("'plain")).toBe("'plain");
    expect(writeSafeCsv([['=HYPERLINK("x")']])).toBe('"\'=HYPERLINK(""x"")"\r\n');
  });
});
