// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LEI structure (ISO 17442-1:2020): 18 upper-case letters or digits followed
 * by two check digits. The same pattern is used by the EBA validation rules
 * v8826_m and v8890_m to v8897_m: `^[A-Z0-9]{18}[0-9]{2}$`.
 */
export const LEI_PATTERN = /^[A-Z0-9]{18}[0-9]{2}$/;

/** ISO 7064 MOD 97-10 remainder of an alphanumeric string (letters A=10 ... Z=35). */
export function mod97(value: string): number {
  let rem = 0;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const d of digits) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem;
}

/** Result of an LEI check. */
export type LeiProblem = 'format' | 'checksum' | null;

/**
 * Checks an LEI locally: the structure and the check digits (ISO 17442 uses
 * ISO 7064 MOD 97-10; a valid LEI gives remainder 1). This cannot tell
 * whether the LEI is issued, active or lapsed; that needs the GLEIF database
 * (ESAs business checks VR_2, VR_12, VR_23, VR_71, VR_77).
 */
export function checkLei(value: string): LeiProblem {
  if (!LEI_PATTERN.test(value)) return 'format';
  return mod97(value) === 1 ? null : 'checksum';
}

/** Computes the two check digits for an 18-character LEI prefix. */
export function leiCheckDigits(prefix: string): string {
  if (!/^[A-Z0-9]{18}$/.test(prefix)) throw new RangeError('LEI prefix must be 18 upper-case letters or digits');
  const check = 98 - mod97(`${prefix}00`);
  return String(check).padStart(2, '0');
}

/**
 * Checks the structure of an EUID (European Unique Identifier) locally.
 * Commission Implementing Regulation (EU) 2021/1042, Annex, point 9: the EUID
 * contains a country code, a register identifier and the registration
 * number (and optionally a verification digit). The ESAs' DORA FAQ (question
 * 45) adds that country and register identifier are separated from the
 * company's number by a dot, which is part of the code. Only that structure
 * is checked: two letters, register identifier, a dot, registration number.
 * Whether the EUID exists needs BRIS (ESAs checks VR_72, VR_78).
 */
export function checkEuid(value: string): boolean {
  return /^[A-Z]{2}[^.\s]+\.[^\s]+$/.test(value) && !value.endsWith('.');
}
