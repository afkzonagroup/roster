// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** `yyyy-mm-dd` with a real calendar date (ISO 8601 calendar date, as required by the ITS and EBA check 330). */
export function isIsoDate(value: string): boolean {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  return d <= days;
}

/** Lexical form of xs:integer: optional sign and digits. */
export function isInteger(value: string): boolean {
  return /^[+-]?[0-9]+$/.test(value);
}

/** Lexical form of xs:decimal: optional sign, digits, optional fraction. No exponent, no grouping. */
export function isDecimal(value: string): boolean {
  return /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/.test(value);
}

/** Canonical form of an integer for key comparison: `+007` and `7` are the same key. */
export function canonicalInteger(value: string): string {
  if (!isInteger(value)) return value;
  const neg = value.startsWith('-');
  const digits = value.replace(/^[+-]/, '').replace(/^0+(?=[0-9])/, '');
  return neg && digits !== '0' ? `-${digits}` : digits;
}
