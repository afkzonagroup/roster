// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { fail } from './errors.ts';

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/**
 * Decodes UTF-8 strictly. Invalid byte sequences are rejected, never
 * replaced, so data is not silently changed. A leading byte order mark is
 * removed (xBRL-CSV and EBA filing rule 1.4 allow UTF-8 with or without BOM).
 */
export function decodeUtf8(bytes: Uint8Array, what: string): string {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    return fail('encoding.not-utf8', `${what} is not valid UTF-8. Save it as UTF-8 (EBA filing rule 1.4).`);
  }
}

const ENCODER = new TextEncoder();

/** Encodes a string as UTF-8 without a byte order mark. */
export function encodeUtf8(text: string): Uint8Array {
  return ENCODER.encode(text);
}

/**
 * Characters that xBRL-CSV 1.0 does not allow in a cell (section 3.2.1,
 * TEXTDATA production, plus CR and LF which are allowed inside quoted
 * fields): C0 controls other than tab, CR and LF, lone surrogates, and the
 * noncharacters U+FFFE and U+FFFF.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const NOT_XBRL_CSV = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** True when the value contains a character that xBRL-CSV does not allow in a cell. */
export function hasForbiddenCharacter(value: string): boolean {
  return NOT_XBRL_CSV.test(value);
}

/** DEL and C1 control characters: allowed by xBRL-CSV but almost always an error. */
const C1 = /[\u007f-\u009f]/;

/** True when the value contains DEL or a C1 control character. */
export function hasC1Control(value: string): boolean {
  return C1.test(value);
}

/**
 * Bidirectional overrides and isolates, zero-width characters and line or
 * paragraph separators. They are legal Unicode but can make a value look
 * different from what it is (Trojan Source style spoofing).
 */
const INVISIBLE = /[\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/u;

/** True when the value contains invisible or bidirectional control characters. */
export function hasInvisibleCharacter(value: string): boolean {
  return INVISIBLE.test(value);
}

/**
 * Makes a string safe to print on a terminal or in a single-line message:
 * control, invisible and bidirectional characters become `\u{...}` escapes,
 * and the result is cut to `max` characters.
 */
export function printable(value: string, max = 512): string {
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    const unsafe =
      cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || INVISIBLE.test(ch) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff;
    out += unsafe ? `\\u{${cp.toString(16)}}` : ch;
    if (out.length >= max) return `${out.slice(0, max)}...`;
  }
  return out;
}

/** True for a string made only of ASCII letters and digits. */
export function isAsciiAlnum(value: string): boolean {
  return /^[A-Za-z0-9]+$/.test(value);
}
