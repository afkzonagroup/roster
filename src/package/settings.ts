// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy } from '../taxonomy/types.ts';
import type { Register } from '../model/register.ts';
import { checkLei } from '../validate/identifiers.ts';
import { isIsoDate } from '../validate/values.ts';
import type { Finding } from '../validate/finding.ts';

/** Report-level settings: who reports, for which date, in which currency. */
export interface ReportSettings {
  /** LEI of the reporting entity (ReportSubject). */
  readonly lei: string;
  /** `CON` for a consolidated or sub-consolidated register, `IND` for an individual entity. */
  readonly consolidation: 'CON' | 'IND';
  /** ISO 3166-1 alpha-2 code of the reporting entity's country (used in the file name). */
  readonly country: string;
  /** Reference date, `yyyy-mm-dd`. From 2026 the ESAs use 31 December of the preceding year. */
  readonly referenceDate: string;
  /** ISO 4217 code of the currency of monetary amounts (parameter baseCurrency). */
  readonly baseCurrency: string;
  /** Decimals of monetary amounts (parameter decimalsMonetary): an integer of -4 or more, or `INF`. */
  readonly decimalsMonetary: number | 'INF';
  /** Decimals of integers (parameter decimalsInteger): 0 or `INF`. */
  readonly decimalsInteger: number | 'INF';
}

/** Default accuracy settings: as in the EBA's DORA sample package. */
export const DEFAULT_DECIMALS = Object.freeze({ decimalsMonetary: -3, decimalsInteger: 0 } as const);

/** Codes (without the `eba_GA:`/`eba_CU:` prefix) of the countries and currencies in the taxonomy. */
export function isoCodes(taxonomy: Taxonomy, template: string, column: string, prefix: string): Set<string> {
  const t = taxonomy.templates.find((x) => x.code === template);
  const c = t?.columns.find((x) => x.code === column);
  const members = c?.enumeration === null || c === undefined ? [] : (taxonomy.enumerations[c.enumeration] ?? []);
  return new Set(members.filter((m) => m.startsWith(prefix)).map((m) => m.slice(prefix.length)));
}

/**
 * Fills settings that are not given from template B_01.01 (LEI and country
 * of the entity maintaining the register).
 */
export function settingsFromRegister(register: Register, given: Partial<ReportSettings>): Partial<ReportSettings> {
  const row = register.tables.get('B_01.01')?.rows[0];
  const lei = given.lei ?? row?.values.c0010;
  const countryCode = row?.values.c0030;
  const country = given.country ?? (countryCode?.startsWith('eba_GA:') === true ? countryCode.slice(7) : undefined);
  return {
    ...given,
    ...(lei !== undefined ? { lei } : {}),
    ...(country !== undefined ? { country } : {}),
    decimalsMonetary: given.decimalsMonetary ?? DEFAULT_DECIMALS.decimalsMonetary,
    decimalsInteger: given.decimalsInteger ?? DEFAULT_DECIMALS.decimalsInteger,
  };
}

/**
 * Checks report settings. `now` is the current time, for EBA check 111
 * (reference date not in the future).
 */
export function checkSettings(s: Partial<ReportSettings>, now: Date, taxonomy: Taxonomy = DORA_4_0): Finding[] {
  const out: Finding[] = [];
  const err = (rule: string, message: string): void => {
    out.push({ rule, severity: 'error', message });
  };
  if (s.lei === undefined) err('roster.settings', 'The LEI of the reporting entity is missing (set it, or fill B_01.01 c0010).');
  else if (checkLei(s.lei) !== null) err('its.lei', `The LEI of the reporting entity "${s.lei}" is not a valid LEI.`);
  if (s.consolidation !== 'CON' && s.consolidation !== 'IND') err('roster.settings', 'Consolidation must be CON (consolidated or sub-consolidated) or IND (individual).');
  if (s.country === undefined || !isoCodes(taxonomy, 'B_01.01', 'c0030', 'eba_GA:').has(s.country)) {
    err('esa.105', 'The country must be an ISO 3166-1 alpha-2 code known to the taxonomy (for example LU).');
  }
  if (s.referenceDate === undefined || !isIsoDate(s.referenceDate)) err('esa.109', 'The reference date must be a valid date yyyy-mm-dd.');
  else if (s.referenceDate > now.toISOString().slice(0, 10)) err('esa.111', `The reference date ${s.referenceDate} is in the future.`);
  if (s.baseCurrency === undefined || !isoCodes(taxonomy, 'B_01.02', 'c0100', 'eba_CU:').has(s.baseCurrency)) {
    err('roster.settings', 'The base currency must be an ISO 4217 code known to the taxonomy (for example EUR).');
  }
  const dm = s.decimalsMonetary;
  if (!(dm === 'INF' || (typeof dm === 'number' && Number.isInteger(dm) && dm >= -4 && dm <= 20))) {
    err('eba-fr.2.18', 'decimalsMonetary must be an integer of -4 or more, or INF (EBA filing rule 2.18).');
  }
  const di = s.decimalsInteger;
  if (!(di === 'INF' || di === 0)) err('eba-fr.2.18', 'decimalsInteger must be 0 or INF (EBA filing rule 2.18).');
  return out;
}
