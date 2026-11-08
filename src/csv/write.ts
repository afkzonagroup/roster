// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Quotes one field as required by RFC 4180 and by the EBA filing rules
 * (footnote 27 of filing rules v5.9): a field that contains a comma, a
 * carriage return, a line feed or a double quote is enclosed in double
 * quotes, and every double quote inside it is doubled.
 */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Writes records as CSV with CR LF line endings (the line ending used in the
 * EBA sample report packages). Every record ends with a line ending.
 */
export function writeCsv(records: readonly (readonly string[])[]): string {
  let out = '';
  for (const record of records) out += `${record.map(csvField).join(',')}\r\n`;
  return out;
}

/**
 * Neutralises a value for a CSV file that people open in a spreadsheet
 * program (findings reports, editable templates). A value that a spreadsheet
 * could run as a formula (starting with `=`, `+`, `-`, `@`, tab, CR or LF,
 * also after leading spaces, also the full-width forms) gets a leading
 * apostrophe. Plain numbers such as `-12.5` are left as they are. Never used for the regulatory report package, whose values must
 * stay exactly as reported.
 */
export function neutraliseFormula(value: string): string {
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return value;
  return /^[\s\u3000]*[=+\-@\t\r\n＝＋－＠]/.test(value) ? `'${value}` : value;
}

/** Writes CSV for spreadsheet users: formula-like values are neutralised. */
export function writeSafeCsv(records: readonly (readonly string[])[]): string {
  return writeCsv(records.map((r) => r.map(neutraliseFormula)));
}
