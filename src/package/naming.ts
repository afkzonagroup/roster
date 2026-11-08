// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { Framework } from '../taxonomy/types.ts';

/** `YYYYMMDDhhmmssfff` in UTC, as in EBA file names. */
export function creationTimestamp(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}`;
}

/** `DORA010100`: framework code in upper case and the module version in six digits. */
export function frameworkModuleVersion(f: Framework): string {
  const parts = f.moduleVersion.split('.').map((x) => x.padStart(2, '0'));
  return `${f.code.toUpperCase()}${parts.join('')}`;
}

/**
 * The report package name of EBA filing rules v5.9 (examples section) and
 * the ESAs' DORA FAQ (question 24):
 * `ReportSubject_Country_FrameworkCodeModuleVersion_Module_ReferenceDate_CreationTimestamp`,
 * e.g. `DUMMYLEI123456789012.CON_IT_DORA010100_DORA_2025-03-31_20250421141632000`.
 */
export function packageBaseName(f: Framework, lei: string, consolidation: 'CON' | 'IND', country: string, referenceDate: string, created: Date): string {
  return `${lei}.${consolidation}_${country}_${frameworkModuleVersion(f)}_${f.module.replace(/_/g, '').toUpperCase()}_${referenceDate}_${creationTimestamp(created)}`;
}

/** Parsed parts of a report package file name, or null when it does not follow the structure (EBA check 105). */
export interface PackageName {
  readonly subject: string;
  readonly lei: string;
  readonly consolidation: string;
  readonly country: string;
  readonly frameworkModuleVersion: string;
  readonly module: string;
  readonly referenceDate: string;
  readonly timestamp: string;
}

export function parsePackageName(base: string): PackageName | null {
  const m = /^(([A-Z0-9]{20})\.(CON|IND))_([A-Z]{2})_([A-Z]+[0-9]{6})_([A-Z0-9]+)_([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{17})$/.exec(base);
  if (m === null) return null;
  return {
    subject: m[1] ?? '',
    lei: m[2] ?? '',
    consolidation: m[3] ?? '',
    country: m[4] ?? '',
    frameworkModuleVersion: m[5] ?? '',
    module: m[6] ?? '',
    referenceDate: m[7] ?? '',
    timestamp: m[8] ?? '',
  };
}
