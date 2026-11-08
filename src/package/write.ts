// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { writeCsv } from '../csv/write.ts';
import type { Register, RegisterRow } from '../model/register.ts';
import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy, Template } from '../taxonomy/types.ts';
import { encodeUtf8 } from '../util/text.ts';
import type { DeflateCodec } from '../zip/codec.ts';
import { writeZip, type ZipInput } from '../zip/write.ts';
import { canonicalInteger, isInteger } from '../validate/values.ts';
import { packageBaseName } from './naming.ts';
import type { ReportSettings } from './settings.ts';

/** The fixed content of META-INF/reportPackage.json (Report Package 1.0, unconstrained package with .zip extension). */
export const REPORT_PACKAGE_JSON = `{\n  "documentInfo": {\n    "documentType": "https://xbrl.org/report-package/2023"\n  }\n}\n`;

/** report.json: an xBRL-CSV report that extends only the module's JSON entry point (EBA filing rule 1.5, check 505). */
export function reportJson(taxonomy: Taxonomy = DORA_4_0): string {
  return `${JSON.stringify({ documentInfo: { documentType: taxonomy.framework.reportDocumentType, extends: [taxonomy.framework.entryPoint] } }, null, 2)}\n`;
}

/** A decimals parameter: an integer, or `#none` for infinite accuracy (xBRL-CSV 1.0 section 3.1.13). */
function decimals(v: number | 'INF'): string {
  return v === 'INF' ? '#none' : String(v);
}

/** parameters.csv with the parameters the DORA module uses. */
export function parametersCsv(s: ReportSettings): string {
  return writeCsv([
    ['name', 'value'],
    ['entityID', `rs:${s.lei}.${s.consolidation}`],
    ['refPeriod', s.referenceDate],
    ['baseCurrency', `iso4217:${s.baseCurrency}`],
    ['decimalsInteger', decimals(s.decimalsInteger)],
    ['decimalsMonetary', decimals(s.decimalsMonetary)],
  ]);
}

/**
 * FilingIndicators.csv: every template of the module with `true`. The ESAs
 * require all filing indicators to be true, with empty templates reported
 * empty (check 808); EBA filing rule 1.6 requires one indicator per template.
 */
export function filingIndicatorsCsv(taxonomy: Taxonomy = DORA_4_0): string {
  return writeCsv([['templateID', 'reported'], ...taxonomy.templates.map((t) => [t.code, 'true'])]);
}

/** Column order of xBRL-CSV table constraints: primary key fields first, then the other columns by name. */
export function columnOrder(template: Template): string[] {
  const rest = template.columns.map((c) => c.code).filter((c) => !template.primaryKey.includes(c)).sort();
  return [...template.primaryKey, ...rest];
}

/** xBRL-CSV special values: a cell value starting with `#` is written as `##` (xBRL-CSV 1.0 section 3.2.4). */
export function escapeSpecial(value: string): string {
  return value.startsWith('#') ? `#${value}` : value;
}

function compareRows(template: Template, a: RegisterRow, b: RegisterRow): number {
  for (const code of template.primaryKey) {
    const col = template.columns.find((c) => c.code === code);
    const x = a.values[code] ?? '';
    const y = b.values[code] ?? '';
    if (col?.type === 'i' && isInteger(x) && isInteger(y)) {
      const d = BigInt(canonicalInteger(x)) - BigInt(canonicalInteger(y));
      if (d !== 0n) return d < 0n ? -1 : 1;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The CSV of one template, as written into the package. */
export function tableCsv(template: Template, rows: readonly RegisterRow[]): string {
  const order = columnOrder(template);
  const sorted = [...rows].sort((a, b) => compareRows(template, a, b));
  const out: string[][] = [order];
  for (const row of sorted) {
    out.push(
      order.map((code) => {
        const col = template.columns.find((c) => c.code === code);
        // "Link" columns carry the fact that makes a key-only row exist (ESAs FAQ 35).
        if (col?.type === 't') return 'true';
        return escapeSpecial(row.values[code] ?? '');
      }),
    );
  }
  return writeCsv(out);
}

/** A written report package. */
export interface ReportPackage {
  /** File name, e.g. `<LEI>.CON_LU_DORA010100_DORA_2025-12-31_20260115093000000.zip`. */
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/**
 * Writes the xBRL-CSV report package of a register: a ZIP with one
 * top-level folder named like the file, `META-INF/reportPackage.json`, and in
 * `reports/` the files `report.json`, `parameters.csv`,
 * `FilingIndicators.csv` and one CSV per template (EBA filing rules v5.9,
 * "xBRL-CSV reports"; Report Package 1.0; xBRL-CSV 1.0). The settings must
 * have been checked with `checkSettings` and the register with
 * `validateRegister`; this function does not validate.
 */
export async function writeReportPackage(register: Register, settings: ReportSettings, codec: DeflateCodec, created: Date, taxonomy: Taxonomy = DORA_4_0): Promise<ReportPackage> {
  const base = packageBaseName(taxonomy.framework, settings.lei, settings.consolidation, settings.country, settings.referenceDate, created);
  const files: ZipInput[] = [
    { name: `${base}/` },
    { name: `${base}/META-INF/` },
    { name: `${base}/META-INF/reportPackage.json`, data: encodeUtf8(REPORT_PACKAGE_JSON) },
    { name: `${base}/reports/` },
    { name: `${base}/reports/report.json`, data: encodeUtf8(reportJson(taxonomy)) },
    { name: `${base}/reports/parameters.csv`, data: encodeUtf8(parametersCsv(settings)) },
    { name: `${base}/reports/${taxonomy.framework.filingIndicatorTable}`, data: encodeUtf8(filingIndicatorsCsv(taxonomy)) },
  ];
  for (const template of taxonomy.templates) {
    const rows = register.tables.get(template.code)?.rows ?? [];
    files.push({ name: `${base}/reports/${template.file}`, data: encodeUtf8(tableCsv(template, rows)) });
  }
  return { fileName: `${base}.zip`, bytes: await writeZip(files, codec, created) };
}
