// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { fail } from '../util/errors.ts';

/** Limits applied while parsing CSV. All are hard upper bounds. */
export interface CsvLimits {
  /** Maximum number of records, header included. */
  readonly maxRecords: number;
  /** Maximum number of fields in one record. */
  readonly maxFields: number;
  /** Maximum length of one field in UTF-16 code units. */
  readonly maxFieldLength: number;
}

/** Defaults sized for a register of information of a large group. */
export const DEFAULT_CSV_LIMITS: CsvLimits = Object.freeze({
  maxRecords: 1_000_000,
  maxFields: 256,
  maxFieldLength: 100_000,
});

/** One parsed record with the 1-based line number where it starts. */
export interface CsvRecord {
  readonly line: number;
  readonly fields: readonly string[];
}

/**
 * Parses CSV text as defined by RFC 4180 with the changes made by xBRL-CSV
 * 1.0 section 3.2.1: a line ending may be CR, LF or CR LF, and any Unicode
 * character may appear. The parser is strict: a quote inside an unquoted
 * field, text after a closing quote, or an unterminated quoted field is an
 * error with a line number. Empty lines produce a record with one empty
 * field, as in RFC 4180; callers decide what blank records mean.
 *
 * @param text - CSV text, already decoded from UTF-8 (BOM removed).
 * @param what - name of the input for error messages.
 */
export function parseCsv(text: string, what: string, limits: CsvLimits = DEFAULT_CSV_LIMITS): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const n = text.length;
  // True after a field has been opened with a quote and closed again.
  let quotedDone = false;

  const pushField = (): void => {
    fields.push(field);
    if (fields.length > limits.maxFields) {
      fail('csv.too-many-fields', `${what}, line ${recordLine}: more than ${limits.maxFields} fields.`);
    }
    field = '';
    quotedDone = false;
  };
  const pushRecord = (): void => {
    pushField();
    records.push({ line: recordLine, fields });
    if (records.length > limits.maxRecords) {
      fail('csv.too-many-records', `${what}: more than ${limits.maxRecords} records.`);
    }
    fields = [];
  };

  while (i < n) {
    const ch = text.charCodeAt(i);
    if (ch === 0x22 /* " */) {
      if (field.length > 0 || quotedDone) {
        fail('csv.stray-quote', `${what}, line ${line}: a double quote inside an unquoted field. Quote the whole field and double the inner quotes.`);
      }
      // Quoted field.
      const start = line;
      i++;
      let closed = false;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x22) {
          if (i + 1 < n && text.charCodeAt(i + 1) === 0x22) {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (c === 0x0d) {
          line++;
          if (i + 1 < n && text.charCodeAt(i + 1) === 0x0a) {
            field += '\r\n';
            i += 2;
            continue;
          }
        } else if (c === 0x0a) {
          line++;
        }
        field += text.charAt(i);
        i++;
        if (field.length > limits.maxFieldLength) {
          fail('csv.field-too-long', `${what}, line ${start}: a field is longer than ${limits.maxFieldLength} characters.`);
        }
      }
      if (!closed) fail('csv.unterminated-quote', `${what}, line ${start}: a quoted field is not closed.`);
      quotedDone = true;
      if (i < n) {
        const next = text.charCodeAt(i);
        if (next !== 0x2c && next !== 0x0d && next !== 0x0a) {
          fail('csv.text-after-quote', `${what}, line ${line}: text after a closing quote.`);
        }
      }
      continue;
    }
    if (ch === 0x2c /* , */) {
      pushField();
      i++;
      continue;
    }
    if (ch === 0x0d || ch === 0x0a) {
      pushRecord();
      i += ch === 0x0d && i + 1 < n && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      line++;
      recordLine = line;
      continue;
    }
    if (quotedDone) fail('csv.text-after-quote', `${what}, line ${line}: text after a closing quote.`);
    field += text.charAt(i);
    i++;
    if (field.length > limits.maxFieldLength) {
      fail('csv.field-too-long', `${what}, line ${recordLine}: a field is longer than ${limits.maxFieldLength} characters.`);
    }
  }
  // A final record without a line ending. A file that ends with a line ending
  // has no further record (RFC 4180: the last record may or may not end with one).
  if (field.length > 0 || fields.length > 0 || quotedDone) pushRecord();
  return records;
}

/** True when every field of the record is empty. */
export function isBlankRecord(record: CsvRecord): boolean {
  return record.fields.every((f) => f === '');
}
