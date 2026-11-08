// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { Register } from './model/register.ts';
import { checkSettings, settingsFromRegister, type ReportSettings } from './package/settings.ts';
import { writeReportPackage, type ReportPackage } from './package/write.ts';
import { DORA_4_0 } from './taxonomy/dora.ts';
import type { Taxonomy } from './taxonomy/types.ts';
import { countBySeverity, type Finding, type Severity } from './validate/finding.ts';
import { validateRegister, type NotEvaluated } from './validate/register.ts';
import type { DeflateCodec } from './zip/codec.ts';

/** Attribution notice required by LICENSE-ADDITIONAL-TERMS.md (AGPL section 7(b)). */
export const ATTRIBUTION = 'Roster by AFKzona Group';
export const ATTRIBUTION_URL = 'https://afkzonagroup.lt';

/** Options for {@link checkRegister}. */
export interface CheckOptions {
  /** Report settings; when given, the register is checked for reporting (settings and "mandatory in case of reporting"). */
  readonly settings?: Partial<ReportSettings>;
  readonly includeInactiveRules?: boolean;
  readonly maxFindings?: number;
  /** Current time, for the "reference date not in the future" check. */
  readonly now?: Date;
  readonly taxonomy?: Taxonomy;
}

/** The outcome of {@link checkRegister}. */
export interface CheckResult {
  readonly findings: readonly Finding[];
  readonly counts: Record<Severity, number>;
  readonly truncated: number;
  readonly rulesRun: readonly string[];
  readonly notEvaluated: readonly NotEvaluated[];
  /** Settings after defaults from the register were applied. */
  readonly settings?: Partial<ReportSettings>;
}

/**
 * Validates a register and, when settings are given, the report settings.
 *
 * @example
 * ```ts
 * const result = checkRegister(register, { settings: { consolidation: 'IND', referenceDate: '2025-12-31', baseCurrency: 'EUR' } });
 * if (result.counts.error > 0) console.log(result.findings);
 * ```
 */
export function checkRegister(register: Register, options: CheckOptions = {}): CheckResult {
  const taxonomy = options.taxonomy ?? DORA_4_0;
  const reporting = options.settings !== undefined;
  const settings = reporting ? settingsFromRegister(register, options.settings ?? {}) : undefined;
  const v = validateRegister(register, {
    reporting,
    ...(settings?.referenceDate !== undefined ? { referenceDate: settings.referenceDate } : {}),
    ...(options.includeInactiveRules !== undefined ? { includeInactiveRules: options.includeInactiveRules } : {}),
    ...(options.maxFindings !== undefined ? { maxFindings: options.maxFindings } : {}),
    taxonomy,
  });
  const findings = settings === undefined ? [...v.findings] : [...checkSettings(settings, options.now ?? new Date(), taxonomy), ...v.findings];
  if ([...register.tables.values()].every((t) => t.rows.length === 0)) {
    findings.push({ rule: 'esa.724', severity: 'error', message: 'The register has no data rows.' });
  }
  return {
    findings,
    counts: countBySeverity(findings),
    truncated: v.truncated,
    rulesRun: v.rulesRun,
    notEvaluated: v.notEvaluated,
    ...(settings !== undefined ? { settings } : {}),
  };
}

/** Result of {@link buildPackage}: the package, or why it was not written. */
export type BuildResult = { readonly ok: true; readonly package: ReportPackage; readonly check: CheckResult } | { readonly ok: false; readonly check: CheckResult };

/**
 * Checks a register for reporting and writes its xBRL-CSV report package.
 * Nothing is written when there are errors, unless `force` is set (a package
 * with errors will be rejected by the ESAs or flagged in their feedback).
 */
export async function buildPackage(
  register: Register,
  settings: Partial<ReportSettings>,
  codec: DeflateCodec,
  options: CheckOptions & { readonly created?: Date; readonly force?: boolean } = {},
): Promise<BuildResult> {
  const check = checkRegister(register, { ...options, settings });
  const s = check.settings ?? {};
  const settingsErrors = checkSettings(s, options.now ?? new Date(), options.taxonomy ?? DORA_4_0).length > 0;
  if (settingsErrors || (check.counts.error > 0 && options.force !== true)) return { ok: false, check };
  const pkg = await writeReportPackage(register, s as ReportSettings, codec, options.created ?? options.now ?? new Date(), options.taxonomy ?? DORA_4_0);
  return { ok: true, package: pkg, check };
}
