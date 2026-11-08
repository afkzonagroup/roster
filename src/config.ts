// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { fail } from './util/errors.ts';
import type { ReportSettings } from './package/settings.ts';

/** File name of the settings file in a register folder. */
export const CONFIG_FILE = 'roster.json';

/**
 * Contents of `roster.json`. Every field is optional in the file; LEI and
 * country default to template B_01.01, decimals to the EBA sample values.
 */
export type RosterConfig = Partial<ReportSettings>;

const KEYS = new Set(['lei', 'consolidation', 'country', 'referenceDate', 'baseCurrency', 'decimalsMonetary', 'decimalsInteger']);

/**
 * Parses and checks `roster.json` strictly: unknown keys and wrong types are
 * errors (a typo must not silently change a report). Values are checked in
 * detail by `checkSettings`.
 */
export function parseConfig(text: string, what = CONFIG_FILE): RosterConfig {
  if (text.length > 64 * 1024) fail('config.too-large', `${what} is larger than 64 KiB.`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('config.invalid-json', `${what} is not valid JSON.`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('config.invalid', `${what} must be a JSON object.`);
  const out: { -readonly [K in keyof ReportSettings]?: ReportSettings[K] } = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === '$schema' || k === 'comment') continue;
    if (!KEYS.has(k)) fail('config.unknown-key', `${what}: unknown setting "${k.slice(0, 40)}".`);
    if (k === 'decimalsMonetary' || k === 'decimalsInteger') {
      if (!(v === 'INF' || (typeof v === 'number' && Number.isInteger(v)))) fail('config.invalid', `${what}: ${k} must be an integer or "INF".`);
      out[k] = v;
    } else if (k === 'consolidation') {
      if (v !== 'CON' && v !== 'IND') fail('config.invalid', `${what}: consolidation must be "CON" or "IND".`);
      out.consolidation = v;
    } else {
      if (typeof v !== 'string' || v.length > 64) fail('config.invalid', `${what}: ${k} must be a short text.`);
      out[k as 'lei' | 'country' | 'referenceDate' | 'baseCurrency'] = v;
    }
  }
  return out;
}
