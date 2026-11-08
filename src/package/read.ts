// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { isBlankRecord, parseCsv } from '../csv/parse.ts';
import { importCsvFiles, type InputFile } from '../import/csv.ts';
import { makeRegister, rowCount, type Register } from '../model/register.ts';
import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy } from '../taxonomy/types.ts';
import { RosterInputError } from '../util/errors.ts';
import { decodeUtf8, printable } from '../util/text.ts';
import type { Finding } from '../validate/finding.ts';
import { isIsoDate } from '../validate/values.ts';
import type { DeflateCodec } from '../zip/codec.ts';
import { DEFAULT_ZIP_LIMITS, openZip, type ZipLimits } from '../zip/read.ts';
import { frameworkModuleVersion, parsePackageName } from './naming.ts';
import { isoCodes, type ReportSettings } from './settings.ts';

/** Result of reading a report package. */
export interface PackageReadResult {
  /** The register inside the package (empty when the package could not be read). */
  readonly register: Register;
  /** Settings found in the file name and parameters.csv, as far as they are valid. */
  readonly settings: Partial<ReportSettings>;
  /** Technical findings about the package (ESAs checks 1xx, 3xx, 5xx, 7xx, 8xx, Report Package 1.0). */
  readonly findings: readonly Finding[];
}

const PARAMETERS = ['entityID', 'refPeriod', 'baseCurrency', 'decimalsInteger', 'decimalsMonetary'];

/**
 * Reads and checks an xBRL-CSV report package of the DORA module: file name
 * (ESAs checks 101, 104, 105, 106, 109, 111), ZIP integrity (103), package
 * structure (Report Package 1.0; EBA filing rules: root folder named like the
 * file, META-INF/reportPackage.json, reports/report.json), report.json
 * entry point (505, filing rule 1.5), parameters (714, 723, 514, 320,
 * filing rule 2.18), filing indicators (701 to 705, 510, 808, filing rule
 * 1.6) and table files (720, 306, 809, 801, 802). Data checks are left to
 * `validateRegister` on the returned register.
 */
export async function readReportPackage(bytes: Uint8Array, fileName: string, codec: DeflateCodec, options: { taxonomy?: Taxonomy; limits?: ZipLimits; now?: Date } = {}): Promise<PackageReadResult> {
  const taxonomy = options.taxonomy ?? DORA_4_0;
  const findings: Finding[] = [];
  const settings: { -readonly [K in keyof ReportSettings]?: ReportSettings[K] } = {};
  const err = (rule: string, message: string, source?: string): void => {
    findings.push({ rule, severity: 'error', message, ...(source !== undefined ? { source } : {}) });
  };
  const empty: PackageReadResult = { register: makeRegister(new Map(), taxonomy), settings, findings };
  const name = fileName.split(/[/\\]/).pop() ?? fileName;

  // File name.
  if (!name.endsWith('.zip')) err('esa.101', 'The report file name must end with .zip.');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) err('esa.104', 'The file name may contain only letters, digits, hyphens, underscores and dots.');
  const base = name.replace(/\.zip$/, '');
  const parsed = parsePackageName(base);
  if (parsed === null) {
    err('esa.105', 'The file name does not follow ReportSubject.CON|IND_Country_FrameworkCodeModuleVersion_Module_ReferenceDate_CreationTimestamp.zip.');
  } else {
    if (parsed.module !== taxonomy.framework.module.toUpperCase() || parsed.frameworkModuleVersion !== frameworkModuleVersion(taxonomy.framework)) {
      err('esa.106', `The file name names module ${parsed.frameworkModuleVersion}_${parsed.module}; this package must be ${frameworkModuleVersion(taxonomy.framework)}_${taxonomy.framework.module.toUpperCase()}.`);
    }
    if (!isIsoDate(parsed.referenceDate)) err('esa.109', 'The reference date in the file name is not a valid date.');
    else if (parsed.referenceDate > (options.now ?? new Date()).toISOString().slice(0, 10)) err('esa.111', 'The reference date in the file name is in the future.');
    settings.lei = parsed.lei;
    if (parsed.consolidation === 'CON' || parsed.consolidation === 'IND') settings.consolidation = parsed.consolidation;
    settings.country = parsed.country;
    settings.referenceDate = parsed.referenceDate;
  }

  // Archive.
  let zip;
  try {
    zip = openZip(bytes, codec, options.limits ?? DEFAULT_ZIP_LIMITS);
  } catch (e) {
    if (e instanceof RosterInputError) {
      err('esa.103', `The ZIP archive cannot be read: ${e.message}`);
      return empty;
    }
    throw e;
  }
  const tops = new Set(zip.entries.map((e) => e.name.split('/')[0] ?? ''));
  const top = [...tops][0] ?? '';
  if (tops.size !== 1 || !zip.entries.every((e) => e.name.includes('/')) || top === 'META-INF') {
    err('rp.invalidDirectoryStructure', 'The package must contain a single top-level folder (Report Package 1.0, section 4.1).');
    return empty;
  }
  if (top !== base) err('esa.105', `The top-level folder "${printable(top, 80)}" must have the same name as the file (EBA filing rules, xBRL-CSV reports).`);
  const read = async (path: string): Promise<string | undefined> => {
    const e = zip.entry(`${top}/${path}`);
    if (e === undefined || e.isDirectory) return undefined;
    try {
      return decodeUtf8(await zip.read(e), path);
    } catch (x) {
      if (x instanceof RosterInputError) {
        err(x.code.startsWith('encoding') ? 'esa.306' : 'esa.103', x.message, path);
        return '';
      }
      throw x;
    }
  };

  const rp = await read('META-INF/reportPackage.json');
  if (rp === undefined) err('rp.missingReportPackageJson', 'META-INF/reportPackage.json is missing (required by the EBA package structure).');
  else {
    try {
      const j = JSON.parse(rp) as { documentInfo?: { documentType?: unknown } };
      if (j.documentInfo?.documentType !== 'https://xbrl.org/report-package/2023') {
        err('rp.unsupportedReportPackageVersion', 'META-INF/reportPackage.json must declare documentType https://xbrl.org/report-package/2023 for a .zip package.');
      }
    } catch {
      err('rp.invalidJSON', 'META-INF/reportPackage.json is not valid JSON.');
    }
  }
  if (!zip.entries.some((e) => e.name.startsWith(`${top}/reports/`))) err('rp.missingReportsDirectory', 'The reports folder is missing (Report Package 1.0, section 4.7).');

  // report.json
  const report = await read('reports/report.json');
  if (report === undefined || report === '') err('esa.701', 'reports/report.json is missing or empty.');
  else {
    try {
      const j = JSON.parse(report) as { documentInfo?: { documentType?: unknown; extends?: unknown; taxonomy?: unknown } };
      const ext = j.documentInfo?.extends;
      if (j.documentInfo?.documentType !== taxonomy.framework.reportDocumentType) err('esa.505', `report.json must have documentType ${taxonomy.framework.reportDocumentType}.`);
      if (!Array.isArray(ext) || ext.length !== 1 || ext[0] !== taxonomy.framework.entryPoint) {
        err('esa.505', `report.json must extend exactly one entry point: ${taxonomy.framework.entryPoint} (EBA filing rule 1.5).`);
      }
      if (j.documentInfo?.taxonomy !== undefined) err('eba-fr.1.5', 'report.json must not set documentInfo/taxonomy (EBA filing rule 1.5(a)).');
    } catch {
      err('esa.505', 'reports/report.json is not valid JSON.');
    }
  }

  // parameters.csv
  const params = await read('reports/parameters.csv');
  if (params === undefined || params === '') err('esa.701', 'reports/parameters.csv is missing or empty.');
  else {
    try {
      const recs = parseCsv(params, 'parameters.csv').filter((r) => !isBlankRecord(r));
      const head = recs[0];
      if (head?.fields[0] !== 'name' || head.fields[1] !== 'value' || head.fields.slice(2).some((f) => f !== '')) {
        err('esa.723', 'The first row of parameters.csv must be exactly: name,value.');
      }
      const values = new Map<string, string>();
      for (const r of recs.slice(1)) {
        const [k = '', v = '', ...rest] = r.fields;
        if (rest.some((x) => x !== '') || v === '') err('xbrl-csv.invalidParameterCSVFile', `parameters.csv line ${r.line}: a parameter needs exactly a name and a value.`);
        if (values.has(k)) err('xbrl-csv.invalidParameterCSVFile', `parameters.csv: "${printable(k, 30)}" appears twice.`);
        if (!PARAMETERS.includes(k)) err('xbrl-csv.unreferencedParameter', `parameters.csv: "${printable(k, 30)}" is not a parameter of the DORA module.`);
        values.set(k, v);
      }
      const entity = values.get('entityID');
      if (entity === undefined) err('esa.714', 'parameters.csv has no entityID.');
      else {
        if (!/^rs:[A-Z0-9]{20}\.(CON|IND)$/.test(entity)) err('esa.514', 'entityID must be rs:<LEI>.CON or rs:<LEI>.IND.');
        if (parsed !== null && entity !== `rs:${parsed.subject}`) err('esa.714', `entityID ${printable(entity, 40)} does not match the file name (${parsed.subject}).`);
      }
      const ref = values.get('refPeriod');
      if (ref === undefined || !isIsoDate(ref)) err('esa.320', 'refPeriod is missing or not a valid date yyyy-mm-dd.');
      else if (parsed !== null && ref !== parsed.referenceDate) err('esa.320', `refPeriod ${ref} differs from the reference date in the file name.`);
      const cur = values.get('baseCurrency');
      const curCode = cur?.replace(/^iso4217:/, '');
      if (cur === undefined || !cur.startsWith('iso4217:') || curCode === undefined || !isoCodes(taxonomy, 'B_01.02', 'c0100', 'eba_CU:').has(curCode)) {
        err('roster.settings', 'baseCurrency must be iso4217:<code>, e.g. iso4217:EUR.');
      } else settings.baseCurrency = curCode;
      const dm = values.get('decimalsMonetary');
      if (dm !== undefined && !(dm === '#none' || (/^-?[0-9]+$/.test(dm) && Number(dm) >= -4))) err('eba-fr.2.18', 'decimalsMonetary must be an integer of -4 or more.');
      else if (dm !== undefined) settings.decimalsMonetary = dm === '#none' ? 'INF' : Number(dm);
      const di = values.get('decimalsInteger');
      if (di !== undefined && di !== '0' && di !== '#none') err('eba-fr.2.18', 'decimalsInteger must be 0.');
      else if (di !== undefined) settings.decimalsInteger = di === '#none' ? 'INF' : 0;
      if (dm === undefined || di === undefined) err('eba-fr.2.18', 'decimalsMonetary and decimalsInteger must be given in parameters.csv.');
    } catch (e) {
      if (!(e instanceof RosterInputError)) throw e;
      err('esa.809', `parameters.csv: ${e.message}`);
    }
  }

  // FilingIndicators.csv
  const fi = await read(`reports/${taxonomy.framework.filingIndicatorTable}`);
  if (fi === undefined || fi === '') err('esa.701', `reports/${taxonomy.framework.filingIndicatorTable} is missing or empty.`);
  else {
    try {
      const recs = parseCsv(fi, 'FilingIndicators.csv').filter((r) => !isBlankRecord(r));
      const head = recs[0];
      if (head?.fields.length !== 2 || head.fields[0] !== 'templateID' || head.fields[1] !== 'reported') err('esa.702', 'The header of FilingIndicators.csv must be: templateID,reported.');
      const seen = new Set<string>();
      for (const r of recs.slice(1)) {
        if (r.fields.length !== 2) {
          err('esa.702', `FilingIndicators.csv line ${r.line}: wrong number of columns.`);
          continue;
        }
        const [t = '', v = ''] = r.fields;
        if (seen.has(t)) err('esa.703', `FilingIndicators.csv: ${printable(t, 20)} is declared twice.`);
        seen.add(t);
        if (!taxonomy.templates.some((x) => x.code === t)) err('esa.510', `FilingIndicators.csv: ${printable(t, 20)} is not a template of the module.`);
        if (v === '') err('esa.705', `FilingIndicators.csv: no value for ${printable(t, 20)}.`);
        else if (!['true', 'false', '1', '0'].includes(v)) err('esa.704', `FilingIndicators.csv: "${printable(v, 20)}" is not a boolean (true, false, 1, 0).`);
        else if (v === 'false' || v === '0') err('esa.808', `FilingIndicators.csv: ${printable(t, 20)} is false. All filing indicators must be true; report empty templates empty.`);
      }
      for (const t of taxonomy.templates) if (!seen.has(t.code)) err('eba-fr.1.6', `FilingIndicators.csv has no indicator for ${t.code} (EBA filing rule 1.6(d)); the ESAs require all as true (check 808).`);
    } catch (e) {
      if (!(e instanceof RosterInputError)) throw e;
      err('esa.809', `FilingIndicators.csv: ${e.message}`);
    }
  }

  // Template tables.
  const files: InputFile[] = [];
  for (const e of zip.entries) {
    const rel = e.name.slice(top.length + 1);
    if (e.isDirectory || !rel.startsWith('reports/') || !rel.endsWith('.csv')) continue;
    const fileBase = rel.slice('reports/'.length);
    if (fileBase.includes('/') || ['parameters.csv', taxonomy.framework.filingIndicatorTable].includes(fileBase)) continue;
    files.push({ name: fileBase, bytes: await zip.read(e) });
  }
  const imported = importCsvFiles(files, { taxonomy, reportPackage: true });
  findings.push(...imported.findings);
  if (rowCount(imported.register) === 0) err('esa.724', 'No data rows were found in any template.');
  return { register: imported.register, settings, findings };
}
