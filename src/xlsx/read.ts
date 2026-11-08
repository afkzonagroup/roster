// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { fail } from '../util/errors.ts';
import { decodeUtf8 } from '../util/text.ts';
import type { DeflateCodec } from '../zip/codec.ts';
import { DEFAULT_ZIP_LIMITS, openZip, type ZipArchive, type ZipLimits } from '../zip/read.ts';
import { parseXml } from '../xml/sax.ts';

/** Limits for reading a workbook. */
export interface XlsxLimits {
  readonly zip: ZipLimits;
  /** Maximum number of worksheets read. */
  readonly maxSheets: number;
  /** Maximum number of rows in one worksheet. */
  readonly maxRows: number;
  /** Maximum column index (1-based); cells further right are an error. */
  readonly maxColumns: number;
  /** Maximum number of non-empty cells in the whole workbook. */
  readonly maxCells: number;
  /** Maximum number of shared strings. */
  readonly maxSharedStrings: number;
  /** Maximum length of one cell value. */
  readonly maxCellLength: number;
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = Object.freeze({
  zip: DEFAULT_ZIP_LIMITS,
  maxSheets: 64,
  maxRows: 1_048_576,
  maxColumns: 16_384,
  maxCells: 10_000_000,
  maxSharedStrings: 2_000_000,
  maxCellLength: 32_767,
});

/** The kind of value an Excel cell holds. */
export type XlsxCellKind = 'string' | 'number' | 'boolean' | 'error' | 'date';

/** One cell. `text` is the stored value as text; formulas are never evaluated. */
export interface XlsxCell {
  readonly kind: XlsxCellKind;
  readonly text: string;
  /** True when the cell has a formula. `text` is then the value cached by the program that saved the file. */
  readonly formula: boolean;
}

/** A worksheet: rows (1-based) of cells keyed by column (1-based). */
export interface XlsxSheet {
  readonly name: string;
  readonly rows: ReadonlyMap<number, ReadonlyMap<number, XlsxCell>>;
}

/** A workbook read from an `.xlsx` file. */
export interface XlsxWorkbook {
  readonly sheets: readonly XlsxSheet[];
  /** True when the workbook uses the 1904 date system. */
  readonly date1904: boolean;
}

/** Converts a column reference such as `AB` to its 1-based index. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Resolves a relationship target against the directory of the source part; never leaves the package. */
function resolvePart(baseDir: string, target: string): string {
  const raw = target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`;
  const out: string[] = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) fail('xlsx.bad-part', 'A workbook relationship points outside the package.');
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

async function readPart(zip: ZipArchive, name: string, what: string): Promise<string | undefined> {
  const entry = zip.entry(name);
  if (entry === undefined || entry.isDirectory) return undefined;
  return decodeUtf8(await zip.read(entry), what);
}

interface Relationship {
  readonly target: string;
  readonly type: string;
  readonly external: boolean;
}

function parseRels(xml: string, what: string): Map<string, Relationship> {
  const rels = new Map<string, Relationship>();
  parseXml(xml, what, {
    open(name, a) {
      if (name !== 'Relationship') return;
      const id = a.get('Id');
      const target = a.get('Target');
      if (id === undefined || target === undefined) return;
      rels.set(id, { target, type: a.get('Type') ?? '', external: a.get('TargetMode') === 'External' });
    },
  });
  return rels;
}

/**
 * Reads the cell values of an `.xlsx` workbook (Office Open XML,
 * ISO/IEC 29500). Only what is needed for data import is read: the workbook
 * part, shared strings and worksheets. Formulas are never evaluated: a
 * formula cell yields the value cached in the file, marked with
 * `formula: true`. External links, macros (`.xlsm` parts), embedded objects
 * and pivot caches are ignored and never opened. Every step is bounded by
 * {@link XlsxLimits}; the ZIP container is checked against zip bombs and the
 * XML parser refuses document type declarations (XXE).
 */
export async function readXlsx(bytes: Uint8Array, codec: DeflateCodec, limits: XlsxLimits = DEFAULT_XLSX_LIMITS): Promise<XlsxWorkbook> {
  const zip = openZip(bytes, codec, limits.zip);
  const rootRels = await readPart(zip, '_rels/.rels', 'Package relationships');
  let workbookPath = 'xl/workbook.xml';
  if (rootRels !== undefined) {
    for (const rel of parseRels(rootRels, 'Package relationships').values()) {
      if (rel.type.endsWith('/officeDocument') && !rel.external) workbookPath = resolvePart('', rel.target);
    }
  }
  const workbookXml = await readPart(zip, workbookPath, 'Workbook');
  if (workbookXml === undefined) fail('xlsx.invalid', 'The file is not an Excel workbook (.xlsx): no workbook part.');
  const baseDir = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1) : '';
  const sheetRefs: { name: string; rid: string }[] = [];
  let date1904 = false;
  parseXml(workbookXml, 'Workbook', {
    open(name, a) {
      if (name === 'workbookPr') {
        const v = a.get('date1904');
        date1904 = v === '1' || v === 'true';
      } else if (name === 'sheet') {
        const sheetName = a.get('name');
        const rid = a.get('id');
        if (sheetName !== undefined && rid !== undefined) sheetRefs.push({ name: sheetName, rid });
      }
    },
  });
  if (sheetRefs.length > limits.maxSheets) fail('xlsx.limit', `The workbook has more than ${limits.maxSheets} worksheets.`);
  const relsPath = `${baseDir}_rels/${workbookPath.slice(baseDir.length)}.rels`;
  const wbRelsXml = await readPart(zip, relsPath, 'Workbook relationships');
  const wbRels = wbRelsXml === undefined ? new Map<string, Relationship>() : parseRels(wbRelsXml, 'Workbook relationships');

  // Shared strings.
  const shared: string[] = [];
  let sharedPath: string | undefined;
  for (const rel of wbRels.values()) if (rel.type.endsWith('/sharedStrings') && !rel.external) sharedPath = resolvePart(baseDir, rel.target);
  const sharedXml = await readPart(zip, sharedPath ?? `${baseDir}sharedStrings.xml`, 'Shared strings');
  if (sharedXml !== undefined) {
    let inSi = false;
    let inT = false;
    let inPhonetic = 0;
    let current = '';
    parseXml(sharedXml, 'Shared strings', {
      open(name) {
        if (name === 'si') {
          inSi = true;
          current = '';
        } else if (name === 'rPh') inPhonetic++;
        else if (name === 't' && inSi && inPhonetic === 0) inT = true;
      },
      close(name) {
        if (name === 'si') {
          inSi = false;
          shared.push(current);
          if (shared.length > limits.maxSharedStrings) fail('xlsx.limit', `More than ${limits.maxSharedStrings} shared strings.`);
        } else if (name === 'rPh') inPhonetic--;
        else if (name === 't') inT = false;
      },
      text(t) {
        if (inT) {
          current += t;
          if (current.length > limits.maxCellLength) fail('xlsx.limit', `A text value is longer than ${limits.maxCellLength} characters.`);
        }
      },
    });
  }

  let cells = 0;
  const sheets: XlsxSheet[] = [];
  for (const ref of sheetRefs) {
    const rel = wbRels.get(ref.rid);
    if (rel === undefined || rel.external) continue;
    if (!rel.type.endsWith('/worksheet')) continue; // chartsheets, dialog sheets, macro sheets
    const path = resolvePart(baseDir, rel.target);
    const xml = await readPart(zip, path, `Worksheet "${ref.name}"`);
    if (xml === undefined) fail('xlsx.invalid', `Worksheet "${ref.name}" is missing from the workbook.`);
    const rows = new Map<number, Map<number, XlsxCell>>();
    let rowNo = 0;
    let colNo = 0;
    let cellType = 'n';
    let inValue = false;
    let inInline = false;
    let inInlineT = false;
    let inCell = false;
    let hasFormula = false;
    let value = '';
    let inlinePhonetic = 0;
    const what = `Worksheet "${ref.name}"`;
    parseXml(xml, what, {
      open(name, a) {
        if (name === 'row') {
          const r = a.get('r');
          rowNo = r !== undefined && /^[0-9]{1,7}$/.test(r) ? Number(r) : rowNo + 1;
          if (rowNo > limits.maxRows) fail('xlsx.limit', `${what} has more than ${limits.maxRows} rows.`);
          colNo = 0;
        } else if (name === 'c') {
          inCell = true;
          const r = a.get('r');
          const m = r === undefined ? null : /^([A-Z]{1,3})([0-9]{1,7})$/.exec(r);
          if (m !== null) {
            colNo = columnIndex(m[1] ?? '');
            rowNo = Number(m[2]);
          } else colNo++;
          if (colNo > limits.maxColumns) fail('xlsx.limit', `${what} has a cell beyond column ${limits.maxColumns}.`);
          cellType = a.get('t') ?? 'n';
          value = '';
          hasFormula = false;
        } else if (name === 'v' && inCell) inValue = true;
        else if (name === 'f' && inCell) hasFormula = true;
        else if (name === 'is' && inCell) inInline = true;
        else if (name === 'rPh' && inInline) inlinePhonetic++;
        else if (name === 't' && inInline && inlinePhonetic === 0) inInlineT = true;
      },
      close(name) {
        if (name === 'v') inValue = false;
        else if (name === 't') inInlineT = false;
        else if (name === 'rPh' && inInline) inlinePhonetic--;
        else if (name === 'is') inInline = false;
        else if (name === 'c') {
          inCell = false;
          let cell: XlsxCell | undefined;
          if (cellType === 's') {
            if (value !== '') {
              const idx = /^[0-9]{1,9}$/.test(value) ? Number(value) : -1;
              const s = shared[idx];
              if (s === undefined) fail('xlsx.invalid', `${what}: a cell refers to a missing shared string.`);
              cell = { kind: 'string', text: s, formula: hasFormula };
            }
          } else if (cellType === 'inlineStr' || cellType === 'str') {
            cell = { kind: 'string', text: value, formula: hasFormula };
          } else if (cellType === 'b') {
            if (value !== '') cell = { kind: 'boolean', text: value === '1' ? 'TRUE' : 'FALSE', formula: hasFormula };
          } else if (cellType === 'e') {
            cell = { kind: 'error', text: value, formula: hasFormula };
          } else if (cellType === 'd') {
            if (value !== '') cell = { kind: 'date', text: value, formula: hasFormula };
          } else if (value !== '') {
            cell = { kind: 'number', text: value, formula: hasFormula };
          }
          if (cell !== undefined && (cell.text !== '' || cell.formula)) {
            let row = rows.get(rowNo);
            if (row === undefined) {
              row = new Map();
              rows.set(rowNo, row);
            }
            row.set(colNo, cell);
            cells++;
            if (cells > limits.maxCells) fail('xlsx.limit', `The workbook has more than ${limits.maxCells} cells.`);
          }
        }
      },
      text(t) {
        if (inValue || inInlineT) {
          value += t;
          if (value.length > limits.maxCellLength) fail('xlsx.limit', `${what}: a cell value is longer than ${limits.maxCellLength} characters.`);
        }
      },
    });
    sheets.push({ name: ref.name, rows });
  }
  return { sheets, date1904 };
}

/**
 * Converts an Excel serial date to `yyyy-mm-dd`, or returns undefined when
 * the number is not a whole-day date between 1900 (or 1904) and 9999-12-31.
 * In the 1900 date system serial 1 is 1900-01-01 and serial 60 is the
 * non-existent 1900-02-29 kept by Excel for compatibility, so serials from
 * 61 on are one day ahead. In the 1904 date system serial 0 is 1904-01-01.
 */
export function excelSerialToIsoDate(serial: number, date1904: boolean): string | undefined {
  if (!Number.isInteger(serial)) return undefined;
  let ms: number;
  if (date1904) {
    if (serial < 0) return undefined;
    ms = Date.UTC(1904, 0, 1) + serial * 86_400_000;
  } else {
    if (serial < 1 || serial === 60) return undefined;
    ms = Date.UTC(1900, 0, 1) + (serial < 60 ? serial - 1 : serial - 2) * 86_400_000;
  }
  if (ms > Date.UTC(9999, 11, 31)) return undefined;
  return new Date(ms).toISOString().slice(0, 10);
}
