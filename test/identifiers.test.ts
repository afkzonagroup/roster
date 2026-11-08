// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { checkEuid, checkLei, leiCheckDigits, mod97 } from '../src/validate/identifiers.ts';
import { canonicalInteger, isDecimal, isInteger, isIsoDate } from '../src/validate/values.ts';

describe('LEI (ISO 17442, check digits ISO 7064 MOD 97-10)', () => {
  it('accepts LEIs whose check digits are right', () => {
    // Public LEIs: GLEIF's own, another issued LEI, and the one in the EBA filing rules v5.9 examples.
    for (const lei of ['506700GE1G29325QX363', '5493001KJTIIGC8Y1R12', '7LTWFZYICNSX8D621K86']) expect(checkLei(lei), lei).toBeNull();
  });

  it('rejects wrong check digits and wrong formats', () => {
    expect(checkLei('506700GE1G29325QX364')).toBe('checksum');
    expect(checkLei('506700GE1G29325QX3')).toBe('format');
    expect(checkLei('506700ge1g29325qx363')).toBe('format');
    expect(checkLei('506700GE1G29325QX3AB')).toBe('format');
    expect(checkLei(' 506700GE1G29325QX363')).toBe('format');
    expect(checkLei('DUMMYLEI123456789012')).toBe('checksum');
  });

  it('computes check digits that validate', () => {
    for (const p of ['506700GE1G29325QX3', 'EXAMPLE0PAYMENTS01', '000000000000000000', 'ZZZZZZZZZZZZZZZZZZ']) {
      const lei = `${p}${leiCheckDigits(p)}`;
      expect(checkLei(lei), lei).toBeNull();
      expect(mod97(lei)).toBe(1);
    }
    expect(leiCheckDigits('506700GE1G29325QX3')).toBe('63');
    expect(() => leiCheckDigits('short')).toThrow(RangeError);
  });
});

describe('EUID structure (Implementing Regulation (EU) 2021/1042, Annex point 9; ESAs FAQ 45)', () => {
  it('accepts country code, register identifier, dot and number', () => {
    for (const ok of ['DEK1101R.HRB116737', 'LUEXAMPLE.B000001', 'FRRCS.123456789', 'NLNHR.12345678']) expect(checkEuid(ok), ok).toBe(true);
  });
  it('rejects values without that structure', () => {
    for (const bad of ['HRB116737', 'DE.123', 'de123.4', 'DEK1101R.', 'DEK1101R HRB116737', 'DEK1101RHRB116737', '']) expect(checkEuid(bad), bad).toBe(false);
  });
});

describe('value formats', () => {
  it('dates are real calendar dates in yyyy-mm-dd', () => {
    for (const ok of ['2025-12-31', '2024-02-29', '9999-12-31', '2000-02-29']) expect(isIsoDate(ok), ok).toBe(true);
    for (const bad of ['2025-02-29', '1900-02-29', '2025-13-01', '2025-00-10', '2025-1-1', '31/12/2025', '2025-12-31T00:00', '2025-04-31', '']) expect(isIsoDate(bad), bad).toBe(false);
  });
  it('integers and decimals follow the XML Schema lexical forms', () => {
    for (const ok of ['0', '-7', '+12', '007']) expect(isInteger(ok)).toBe(true);
    for (const bad of ['1.0', '1e3', '', ' 1', '1 000']) expect(isInteger(bad)).toBe(false);
    for (const ok of ['1', '-1.5', '.5', '5.', '+0.25', '2540100.23']) expect(isDecimal(ok)).toBe(true);
    for (const bad of ['1,5', '1e3', '1 000', 'EUR 5', '', '.', '--1', 'NaN', 'Infinity']) expect(isDecimal(bad)).toBe(false);
    expect(canonicalInteger('+007')).toBe('7');
    expect(canonicalInteger('-0')).toBe('0');
    expect(canonicalInteger('-010')).toBe('-10');
    expect(canonicalInteger('x')).toBe('x');
  });
});
