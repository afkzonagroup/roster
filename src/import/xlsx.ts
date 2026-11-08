// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy } from '../taxonomy/types.ts';
import { printable } from '../util/text.ts';
import type { DeflateCodec } from '../zip/codec.ts';
import { DEFAULT_XLSX_LIMITS, excelSerialToIsoDate, readXlsx, type XlsxCell, type XlsxLimits } from '../xlsx/read.ts';
import { RegisterBuilder, type ImportResult } from './common.ts';
import { isDescriptorRow, normaliseTemplateCode, parseHeader } from './normalize.ts';

/** Options for {@link importXlsx}. */
export interface XlsxImportOptions {
  readonly taxonomy?: Taxonomy;
  readonly limits?: XlsxLimits;
  /** Reject formula cells instead of using their cached values. Default false. */
  readonly rejectFormulas?: boolean;
}

/** Number of header rows searched for column codes at the top of a sheet. */
const HEADER_SEARCH_ROWS = 20;

/**
 * Reads a register from an Excel workbook (.xlsx) with one worksheet per
 * template. A sheet is matched by its name (`B_02.01`, `B.02.01`, `b 02 01`,
 * `tB_02.01`). The header row is the first of the top 20 rows that contains
 * column codes (`c0010`, `0010` or `B_02.01.0010`). Rows right under the header
 * that only repeat column names or types are skipped; every other non-blank
 * row is data. Sheets with other names (instructions, lists) are ignored and
 * listed. Formulas are never evaluated: the value saved in the file is used
 * and reported, or the cell is rejected with `rejectFormulas`. Draft "RT"
 * templates of the 2024 dry run are not accepted, as their columns differ.
 */
export async function importXlsx(bytes: Uint8Array, codec: DeflateCodec, options: XlsxImportOptions = {}): Promise<ImportResult> {
  const taxonomy = options.taxonomy ?? DORA_4_0;
  const wb = await readXlsx(bytes, codec, options.limits ?? DEFAULT_XLSX_LIMITS);
  const b = new RegisterBuilder(taxonomy);
  const ignored: string[] = [];
  for (const sheet of wb.sheets) {
    const code = normaliseTemplateCode(sheet.name);
    const template = code === null ? undefined : taxonomy.templates.find((t) => t.code === code);
    if (template === undefined) {
      if (/^\s*RT[._ ][0-9]{2}[._ ][0-9]{2}/i.test(sheet.name)) {
        b.findings.push({ rule: 'import.draft-template', severity: 'error', message: `Sheet "${printable(sheet.name)}" uses the draft "RT" template codes of the 2024 dry run. Use the final B_ templates of Implementing Regulation (EU) 2024/2956.`, source: sheet.name });
      } else ignored.push(sheet.name);
      continue;
    }
    const source = `sheet ${sheet.name}`;
    if (!b.claim(template.code, source)) continue;
    const rowNumbers = [...sheet.rows.keys()].sort((x, y) => x - y);
    const text = (cell: XlsxCell | undefined): string => cell?.text ?? '';
    let headerRow: number | undefined;
    for (const r of rowNumbers) {
      if (r > HEADER_SEARCH_ROWS) break;
      const cells = sheet.rows.get(r);
      if (cells !== undefined && [...cells.values()].some((c) => typeof parseHeader(c.text, template.code) === 'string')) {
        headerRow = r;
        break;
      }
    }
    if (headerRow === undefined) {
      b.findings.push({ rule: 'esa.801', severity: 'error', message: `Sheet "${printable(sheet.name)}": no header row with column codes (c0010, 0010 or ${template.code}.0010) in the first ${HEADER_SEARCH_ROWS} rows.`, template: template.code, source });
      continue;
    }
    const headCells = sheet.rows.get(headerRow) ?? new Map<number, XlsxCell>();
    const width = Math.max(0, ...headCells.keys());
    const headerTexts = Array.from({ length: width }, (_x, i) => text(headCells.get(i + 1)));
    const columns = b.header(template, headerTexts, source, headerRow);
    if (columns === null) continue;
    let leading = true;
    let formulas = 0;
    for (const r of rowNumbers) {
      if (r <= headerRow) continue;
      const cells = sheet.rows.get(r);
      if (cells === undefined) continue;
      const values = new Map<string, string>();
      let outside = false;
      for (const [c, cell] of cells) {
        const code = columns[c - 1];
        if (code === null || code === undefined) {
          if (cell.text.trim() !== '') outside = true;
          continue;
        }
        if (cell.formula) {
          formulas++;
          if (options.rejectFormulas === true) {
            b.findings.push({ rule: 'import.formula', severity: 'error', message: `Formula cell in row ${r}, column ${code}: formulas are not accepted (rejectFormulas).`, template: template.code, column: code, source, line: r });
            continue;
          }
        }
        if (cell.kind === 'error') {
          b.findings.push({ rule: 'import.cell-error', severity: 'error', message: `Row ${r}, column ${code} holds the Excel error ${printable(cell.text, 20)}.`, template: template.code, column: code, source, line: r });
          continue;
        }
        let value = cell.text;
        const col = template.columns.find((x) => x.code === code);
        if (col?.type === 'd' && (cell.kind === 'number' || cell.kind === 'date')) {
          const iso = cell.kind === 'number' ? excelSerialToIsoDate(Number(value), wb.date1904) : /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.exec(value)?.[0];
          if (iso !== undefined) value = iso;
        }
        if (value !== '') values.set(code, value);
      }
      if (outside) {
        b.findings.push({ rule: 'import.outside-columns', severity: 'error', message: `Row ${r} has values in columns without a column code header; they were not read.`, template: template.code, source, line: r });
      }
      if (values.size === 0) continue;
      if (leading && isDescriptorRow(template, values)) continue;
      leading = false;
      b.add(template, values, source, r);
    }
    if (formulas > 0 && options.rejectFormulas !== true) {
      b.findings.push({ rule: 'import.formula', severity: 'warning', message: `Sheet "${printable(sheet.name)}" has ${formulas} formula cells. Roster never runs formulas; it used the values saved in the file. Check them, or paste values.`, template: template.code, source });
    }
  }
  if (ignored.length > 0) {
    b.findings.push({ rule: 'import.ignored-sheets', severity: 'info', message: `Sheets not named after a template were ignored: ${ignored.map((s) => printable(s, 31)).join(', ')}.` });
  }
  return b.result();
}
