// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { DEFAULT_CSV_LIMITS, isBlankRecord, parseCsv, type CsvLimits } from '../csv/parse.ts';
import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy } from '../taxonomy/types.ts';
import { RosterInputError } from '../util/errors.ts';
import { decodeUtf8, printable } from '../util/text.ts';
import { RegisterBuilder, type ImportResult } from './common.ts';
import { normaliseTemplateCode } from './normalize.ts';

/** A file given to an importer: its name (no directories needed) and content. */
export interface InputFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Options for {@link importCsvFiles}. */
export interface CsvImportOptions {
  readonly taxonomy?: Taxonomy;
  readonly limits?: CsvLimits;
  /** Maximum size of one file in bytes (default 64 MiB). */
  readonly maxFileBytes?: number;
  /**
   * The files are the tables of an xBRL-CSV report package: headers must be
   * the exact column codes, values are not converted, and xBRL-CSV special
   * values (`##`, `#nil`, `#empty`, `#none`) are applied.
   */
  readonly reportPackage?: boolean;
}

/** Files of a report package that are not templates. */
const PACKAGE_FILES = new Set(['filingindicators.csv', 'parameters.csv', 'footnotes.csv']);

/**
 * Reads a register from one CSV file per template. A file is matched to its
 * template by name: `b_02.01.csv`, `B_02.01.csv`, `b_0201.csv` and similar.
 * The first row holds column codes (`c0010`, `0010` or `B_02.01.0010`); every
 * other non-blank row is data. Files must be UTF-8 (a BOM is allowed).
 * Values are kept as written, except that closed-list entries are converted
 * to taxonomy codes where that is unambiguous.
 *
 * @example
 * ```ts
 * const { register, findings } = importCsvFiles([{ name: 'b_01.01.csv', bytes }]);
 * ```
 */
export function importCsvFiles(files: readonly InputFile[], options: CsvImportOptions = {}): ImportResult {
  const taxonomy = options.taxonomy ?? DORA_4_0;
  const b = new RegisterBuilder(taxonomy, options.reportPackage === true);
  const maxBytes = options.maxFileBytes ?? 64 * 1024 * 1024;
  for (const file of files) {
    const base = file.name.split(/[/\\]/).pop() ?? file.name;
    if (PACKAGE_FILES.has(base.toLowerCase())) continue;
    const code = options.reportPackage === true ? (taxonomy.templates.find((t) => t.file === base)?.code ?? null) : normaliseTemplateCode(base.replace(/\.csv$/i, ''));
    const template = code === null ? undefined : taxonomy.templates.find((t) => t.code === code);
    if (!/\.csv$/i.test(base) || template === undefined) {
      b.findings.push({ rule: 'esa.720', severity: options.reportPackage === true ? 'error' : 'warning', message: `${printable(base)} is not named after a template (for example b_02.01.csv) and was not read.`, source: base });
      continue;
    }
    if (file.bytes.length > maxBytes) {
      b.findings.push({ rule: 'import.too-large', severity: 'error', message: `${printable(base)} is larger than ${maxBytes} bytes and was not read.`, source: base });
      continue;
    }
    if (!b.claim(template.code, base)) continue;
    let records;
    try {
      records = parseCsv(decodeUtf8(file.bytes, base), base, options.limits ?? DEFAULT_CSV_LIMITS);
    } catch (e) {
      if (!(e instanceof RosterInputError)) throw e;
      b.findings.push({ rule: e.code.startsWith('encoding') ? 'esa.306' : 'esa.809', severity: 'error', message: e.message, template: template.code, source: base });
      continue;
    }
    const head = records[0];
    if (head === undefined || (records.length === 1 && isBlankRecord(head))) continue;
    if (options.reportPackage === true) {
      for (const h of head.fields) {
        if (h === '') b.findings.push({ rule: 'esa.801', severity: 'error', message: 'The header row has an empty cell (EBA filing rules, xBRL-CSV reports extra rule 2).', template: template.code, source: base, line: head.line });
        else if (!/^c[0-9]{4}$/.test(h)) b.findings.push({ rule: 'esa.801', severity: 'error', message: `Header "${printable(h, 40)}" is not a column code of the form c0010.`, template: template.code, source: base, line: head.line });
      }
    }
    const columns = b.header(template, head.fields, base, head.line);
    if (columns === null) continue;
    for (const rec of records.slice(1)) {
      if (isBlankRecord(rec)) continue;
      if (options.reportPackage === true && rec.fields.length !== head.fields.length) {
        // EBA filing rules, xBRL-CSV reports extra rule 3: every row has as many fields as the header.
        b.findings.push({ rule: 'esa.809', severity: 'error', message: `Line ${rec.line} has ${rec.fields.length} fields; the header has ${head.fields.length}.`, template: template.code, source: base, line: rec.line });
        continue;
      }
      if (rec.fields.length > columns.length && rec.fields.slice(columns.length).some((f) => f !== '')) {
        b.findings.push({ rule: 'esa.809', severity: 'error', message: `Line ${rec.line} has more fields than the header.`, template: template.code, source: base, line: rec.line });
        continue;
      }
      const values = new Map<string, string>();
      rec.fields.forEach((f, i) => {
        const c = columns[i];
        if (c !== null && c !== undefined && f !== '') values.set(c, f);
      });
      b.add(template, values, base, rec.line);
    }
  }
  return b.result();
}
