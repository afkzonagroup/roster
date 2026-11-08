// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Generates src/data/dora-4.0.json from the official files in .sources/
// (run `npm run sources:fetch` first). Nothing in the output is typed by
// hand: templates, columns, data types, keys, references, closed lists and
// labels come from the EBA taxonomy package; column names, types and fill-in
// instructions from the Implementing Regulation; validation rules and checks
// from the EBA and ESA spreadsheets. Every source is checked against its
// SHA-256 first. Requires Node >= 22.18.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openZip, type ZipArchive } from '../src/zip/read.ts';
import { nodeCodec } from '../src/zip/node-codec.ts';
import { DEFAULT_XLSX_LIMITS, excelSerialToIsoDate, readXlsx, type XlsxSheet } from '../src/xlsx/read.ts';
import { parseXml } from '../src/xml/sax.ts';
import { parseDpmXl } from '../src/validate/dpmxl.ts';

interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  humanUrl: string;
  file: string;
  sha256: string;
  bytes: number;
}

const ROOT = join(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(ROOT, 'scripts/sources.json'), 'utf8')) as { sources: Source[] };
const BIG = { maxEntries: 200_000, maxEntrySize: 512 * 1024 * 1024, maxTotalSize: 2 * 1024 * 1024 * 1024, maxRatio: 10_000 };

async function source(id: string): Promise<Uint8Array> {
  const s = manifest.sources.find((x) => x.id === id);
  if (s === undefined) throw new Error(`unknown source ${id}`);
  const data = new Uint8Array(await readFile(join(ROOT, '.sources', s.file)));
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== s.sha256) throw new Error(`${id}: checksum mismatch; run npm run sources:fetch`);
  return data;
}

async function text(zip: ZipArchive, name: string): Promise<string> {
  const e = zip.entry(name);
  if (e === undefined) throw new Error(`missing ${name}`);
  return new TextDecoder('utf-8', { fatal: true }).decode(await zip.read(e));
}

async function nested(zip: ZipArchive, suffix: string): Promise<ZipArchive> {
  const e = zip.entries.find((x) => x.name.endsWith(suffix));
  if (e === undefined) throw new Error(`missing ${suffix}`);
  return openZip(await zip.read(e), nodeCodec, BIG);
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const key = (s: string): string =>
  norm(s)
    .toLowerCase()
    .replace(/[‘’'“”"]/g, '')
    .replace(/\(where applicable\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ---------------------------------------------------------------- taxonomy
const taxo = openZip(await source('eba-taxonomy-4.0-errata5'), nodeCodec, BIG);
const rf = await nested(taxo, 'EBA_XBRL_4.0_Reporting_Frameworks_4.0.0.0.zip');
const dict = await nested(taxo, 'EBA_XBRL_4.0_Dictionary_4.0.0.0.zip');
const RF = 'EBA_XBRL_4.0_Reporting_Frameworks_4.0.0.0/www.eba.europa.eu/eu/fr/xbrl/crr/fws/dora/4.0';
const DICT = 'EBA_XBRL_4.0_Dictionary_4.0.0.0/www.eba.europa.eu/eu/fr/xbrl/crr/dict/dom';

interface ModuleJson {
  documentInfo: { 'eba:documentation': { FromReferenceDate: string; ModuleVersion: string; toReferenceDate: string }; extends: string[]; namespaces: Record<string, string> };
  parameters: Record<string, string>;
  dimensions: Record<string, string>;
  tables: Record<string, { 'eba:documentation'?: { FilingIndicator: string }; template: string; url: string; optional?: boolean }>;
}
const moduleJson = JSON.parse(await text(rf, `${RF}/mod/dora.json`)) as ModuleJson;

interface ColumnJson {
  dimensions?: Record<string, string>;
  decimals?: string;
  'eba:documentation': { type: string; AllowedValue?: Record<string, number>; KeyVariableID?: string; CellCode?: string };
}
interface TableJson {
  tableTemplates: Record<string, { columns: Record<string, ColumnJson>; dimensions: Record<string, string>; 'tc:keys': { primary: { fields: string[] }; reference?: { columns: string[]; keyRef: { tableTemplate: string }; name: string }[] } }>;
}

/** Labels of an XBRL label linkbase keyed by the resource's xlink:label. */
function labels(xml: string, what: string, role?: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let buf = '';
  parseXml(xml.replace(/<!DOCTYPE[^>]*>/, ''), what, {
    open(name, a) {
      if (name === 'label' && a.has('label') && (role === undefined || a.get('role') === role)) {
        current = a.get('label') ?? null;
        buf = '';
      }
    },
    text(t) {
      if (current !== null) buf += t;
    },
    close(name) {
      if (name === 'label' && current !== null) {
        out.set(current, norm(buf));
        current = null;
      }
    },
  });
  return out;
}

// ---------------------------------------------------------------- ITS (Annex I)
const itsXml = new TextDecoder('utf-8', { fatal: true }).decode(await source('its-2024-2956'));
interface ItsRow {
  code: string;
  name: string;
  type: string;
  instruction: string;
  fillIn: string;
}
const itsRows: ItsRow[] = [];
const itsTemplates = new Map<string, string>();
/** Rows of the ITS table for template B_99.01: row code, the column whose option it defines, the option. */
const its9901: { row: string; column: string; columnName: string; option: string }[] = [];
let its9901Instruction: string;
{
  // Cell texts with nested tables flattened; rows collected at every level.
  const cellStack: string[] = [];
  const rowStack: string[][] = [];
  parseXml(itsXml.replace(/<!DOCTYPE[^>]*>/, ''), 'ITS', {
    open(name) {
      if (name === 'tr') rowStack.push([]);
      else if (name === 'td' || name === 'th') cellStack.push('');
      else if ((name === 'p' || name === 'br') && cellStack.length > 0) cellStack.push(`${cellStack.pop() ?? ''}\n`);
    },
    text(t) {
      if (cellStack.length > 0) cellStack.push(`${cellStack.pop() ?? ''}${t}`);
    },
    close(name) {
      if (name === 'td' || name === 'th') {
        const cell = cellStack.pop() ?? '';
        rowStack[rowStack.length - 1]?.push(cell);
        if (cellStack.length > 0) cellStack.push(`${cellStack.pop() ?? ''} ${cell} `);
      } else if (name === 'tr') {
        const row = (rowStack.pop() ?? []).map((c) => c.split('\n').map(norm).filter((x) => x !== '').join('\n'));
        const code = norm(row[0] ?? '');
        if (/^B_\d\d\.\d\d\.\d{4}$/.test(code) && row.length === 5) {
          itsRows.push({ code, name: norm(row[1] ?? ''), type: norm(row[2] ?? ''), instruction: row[3] ?? '', fillIn: row[4] ?? '' });
        } else if (/^B_\d\d\.\d\d$/.test(code) && row.length === 3) {
          itsTemplates.set(code, norm(row[1] ?? ''));
        } else if (/^B_99\.01\.R\d{4}$/.test(code)) {
          const cells = row.map(norm).filter((c) => c !== '');
          const prev = its9901[its9901.length - 1];
          if (/^B_\d\d\.\d\d\.\d{4}$/.test(cells[1] ?? '')) {
            its9901.push({ row: code, column: cells[1] ?? '', columnName: cells[2] ?? '', option: (cells[3] ?? '').replace(/^[0-9]+\.\s*/, '') });
          } else if (prev !== undefined) {
            its9901.push({ row: code, column: prev.column, columnName: prev.columnName, option: (cells[1] ?? '').replace(/^[0-9]+\.\s*/, '') });
          }
        }
      }
    },
  });
}
if (itsRows.length < 90) throw new Error(`ITS parse found only ${itsRows.length} columns`);
{
  const m = /Instructions to complete template B_99\.01[^\n]*\n([^\n]+)/.exec(
    itsXml.replace(/<[^>]+>/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n'),
  );
  its9901Instruction = norm(m?.[1] ?? '');
  if (its9901.length !== 19 || its9901Instruction === '') throw new Error(`ITS B_99.01 parse found ${its9901.length} rows`);
}

/**
 * Mandatory status from the ITS "Fill-in Option" text. A column whose
 * instruction starts with "Not applicable if" or "To be left blank if" is
 * conditional even when its fill-in option says "Mandatory" (B_02.01.0030).
 */
function mandatory(fillIn: string, instruction: string): 'mandatory' | 'reporting' | 'optional' | 'conditional' {
  const lines = fillIn.split('\n').map(norm);
  const last = [...lines].reverse().find((l) => /^(Mandatory|Optional)/i.test(l)) ?? lines.join(' ');
  if (/^Mandatory$/i.test(last)) return /^(Not applicable if|To be left blank if)/i.test(norm(instruction)) ? 'conditional' : 'mandatory';
  if (/^Mandatory in case of reporting$/i.test(last)) return 'reporting';
  if (/^Optional/i.test(last)) return 'optional';
  return 'conditional';
}

// ---------------------------------------------------------------- tables
const usedMembers = new Set<string>();
const enumSets = new Map<string, string[]>();
function enumId(members: string[]): string {
  const sorted = [...members].sort();
  const id = createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 12);
  enumSets.set(id, sorted);
  for (const m of sorted) usedMembers.add(m);
  return id;
}

interface OutColumn {
  code: string;
  key: boolean;
  type: string;
  label: string;
  dimension: string | null;
  concept: string | null;
  enumeration: string | null;
  decimals: string | null;
  unit: string | null;
  its: { code: string; name: string; type: string; instruction: string; fillIn: string; status: string } | null;
  /** For a "type of code" column: the identification code column it qualifies. */
  identifies: string | null;
  /** True when the ITS asks for an LEI (ISO 17442) in this column. */
  lei: boolean;
  /** True when the ITS instruction also allows the EUID in this LEI column. */
  euid: boolean;
  /** Maximum length stated in the ITS instruction, if any. */
  maxLength: number | null;
}
const templates: unknown[] = [];
const mappingLog: string[] = [];
const tableEntries = Object.entries(moduleJson.tables).filter(([, t]) => t['eba:documentation'] !== undefined);
for (const [tableId, t] of tableEntries) {
  const filing = t['eba:documentation']?.FilingIndicator ?? '';
  const dir = `${RF}/tab/${filing.toLowerCase()}`;
  const tj = JSON.parse(await text(rf, `${dir}/${filing.toLowerCase()}.json`)) as TableJson;
  const tt = tj.tableTemplates[t.template];
  if (tt === undefined) throw new Error(`no template ${t.template}`);
  const labEn = labels(await text(rf, `${dir}/${filing.toLowerCase()}-lab-en.xml`), `${filing} labels`);
  const labCodes = labels(await text(rf, `${dir}/${filing.toLowerCase()}-lab-codes.xml`), `${filing} codes`);
  const dpmLabel = new Map<string, string>();
  for (const [res, codeText] of labCodes) if (/^[0-9]{4}$/.test(codeText)) dpmLabel.set(`c${codeText}`, labEn.get(res) ?? '');
  const tableLabel = labEn.get(`label_eba_t${filing}`) ?? '';
  const itsForTable = itsRows.filter((r) => r.code.startsWith(`${filing}.`));
  const byName = new Map(itsForTable.map((r) => [key(r.name), r]));
  const dimsByColumn = new Map(Object.entries(tt.dimensions).map(([d, v]) => [v.replace(/^\$/, ''), d]));
  const columns: OutColumn[] = [];
  for (const [code, c] of Object.entries(tt.columns)) {
    const doc = c['eba:documentation'];
    const label = dpmLabel.get(code) ?? '';
    let its: ItsRow | undefined = byName.get(key(label));
    let note = its === undefined ? 'unmatched' : 'name';
    if (filing === 'B_99.01') {
      // B_99.01 is a closed template in the ITS: row R#### defines one option; the DPM column c#### holds it.
      const r = its9901.find((x) => x.row === `B_99.01.R${code.slice(1)}`);
      if (r !== undefined) {
        its = { code: r.row, name: `Definition of "${r.option}" (${r.column} ${r.columnName})`, type: 'Alphanumerical', instruction: its9901Instruction, fillIn: 'Conditional' };
        note = 'b99-row';
      }
    }
    if (its === undefined) {
      // Fall back to the same column number when the names differ only in wording.
      const same = itsForTable.find((r) => r.code === `${filing}.${code.slice(1)}`);
      if (same !== undefined) {
        its = same;
        note = 'number';
      }
    }
    mappingLog.push(`${filing} ${code} "${label}" -> ${its?.code ?? '(none)'} [${note}]`);
    const allowed = doc.AllowedValue === undefined ? null : Object.keys(doc.AllowedValue);
    columns.push({
      code,
      key: doc.KeyVariableID !== undefined,
      type: doc.type,
      label,
      dimension: dimsByColumn.get(code) ?? null,
      concept: c.dimensions?.concept ?? null,
      enumeration: allowed === null ? null : enumId(allowed),
      decimals: c.decimals?.replace(/^\$/, '') ?? null,
      unit: c.dimensions?.unit?.replace(/^\$/, '') ?? null,
      its: its === undefined ? null : { code: its.code, name: its.name, type: its.type, instruction: its.instruction, fillIn: its.fillIn, status: mandatory(its.fillIn, its.instruction) },
      identifies: null,
      lei: its !== undefined && /\bLEI\b/.test(its.name) && /ISO 17442/.test(its.instruction),
      euid: its !== undefined && /\bLEI\b/.test(its.name) && /ISO 17442 standard or the EUID/.test(norm(its.instruction)),
      maxLength: its === undefined ? null : Number(/\(([0-9]+) characters maximum\)/.exec(its.instruction)?.[1] ?? 'NaN') || null,
    });
  }
  columns.sort((a, b) => a.code.localeCompare(b.code));
  // A "type of code" column (closed list of identifier types, domain qCO) qualifies the nearest
  // preceding "Identification code" column of the same template (ITS Annex I column order).
  for (const [i, c] of columns.entries()) {
    const members = c.enumeration === null ? [] : (enumSets.get(c.enumeration) ?? []);
    if (members.length === 0 || !members.every((m) => m.startsWith('eba_qCO:'))) continue;
    const id = columns
      .slice(0, i)
      .reverse()
      .find((x) => x.type === 's' && /^(additional )?identification code/i.test(x.its?.name ?? ''));
    if (id === undefined) throw new Error(`${filing} ${c.code}: no identification code column to pair with`);
    c.identifies = id.code;
    mappingLog.push(`${filing} ${c.code} is the type of code of ${id.code}`);
  }
  const keys = tt['tc:keys'];
  templates.push({
    code: filing,
    tableId,
    templateId: t.template,
    file: t.url,
    label: tableLabel.replace(/^B_\d\d\.\d\d:/, ''),
    itsName: itsTemplates.get(filing) ?? null,
    columns,
    primaryKey: keys.primary.fields,
    references: (keys.reference ?? []).map((r) => ({
      name: norm(r.name),
      columns: r.columns,
      target: (tj.tableTemplates[r.keyRef.tableTemplate] ? r.keyRef.tableTemplate : r.keyRef.tableTemplate).replace(/^B_(\d\d)-(\d\d)$/, 'B_$1.$2'),
    })),
  });
}

// ---------------------------------------------------------------- member labels (Dictionary)
const memberLabels: Record<string, string> = {};
const byDomain = new Map<string, string[]>();
for (const m of usedMembers) {
  const [prefix, code] = m.split(':');
  const dom = (prefix ?? '').replace(/^eba_/, '').toLowerCase();
  const list = byDomain.get(dom) ?? [];
  list.push(code ?? '');
  byDomain.set(dom, list);
}
for (const [dom, codes] of byDomain) {
  const labs = labels(await text(dict, `${DICT}/${dom}/mem-lab-en.xml`), `${dom} member labels`, 'http://www.xbrl.org/2003/role/label');
  const prefix = [...usedMembers].find((m) => m.toLowerCase().startsWith(`eba_${dom}:`))?.split(':')[0] ?? '';
  for (const code of codes) {
    const label = labs.get(`label_eba_${code}`);
    if (label === undefined) throw new Error(`no label for ${prefix}:${code}`);
    memberLabels[`${prefix}:${code}`] = label;
  }
}

// ---------------------------------------------------------------- validation rules
function cellText(sheet: XlsxSheet, row: number, col: number): string {
  return norm(sheet.rows.get(row)?.get(col)?.text ?? '');
}
const vrBook = await readXlsx(await source('eba-validation-rules'), nodeCodec, { ...DEFAULT_XLSX_LIMITS, zip: BIG });
const vrSheet = vrBook.sheets[0];
if (vrSheet === undefined) throw new Error('no VR sheet');
const header = new Map<string, number>();
for (const [col, cell] of vrSheet.rows.get(1) ?? []) header.set(norm(cell.text), col);
const col = (name: string): number => {
  const c = header.get(name);
  if (c === undefined) throw new Error(`VR column ${name} missing`);
  return c;
};
const rules: unknown[] = [];
const isoDate = (s: string): string | null => {
  if (s === '' || s === 'NULL') return null;
  if (/^[0-9]+(\.0+)?$/.test(s)) return excelSerialToIsoDate(Number(s), vrBook.date1904) ?? null;
  return s.slice(0, 10);
};
for (const [r] of [...vrSheet.rows].sort((a, b) => a[0] - b[0])) {
  if (r === 1) continue;
  if (cellText(vrSheet, r, col('Frameworks')) !== 'DORA') continue;
  const expression = cellText(vrSheet, r, col('Expression'));
  const parsed = parseDpmXl(expression);
  const description = cellText(vrSheet, r, col('Description'));
  rules.push({
    code: cellText(vrSheet, r, col('VR Code')),
    source: cellText(vrSheet, r, col('Source')),
    module: cellText(vrSheet, r, col('Modules')),
    tables: cellText(vrSheet, r, col('Tables')).split(/[;,]\s*/).filter((x) => x !== ''),
    expression,
    precondition: cellText(vrSheet, r, col('Precondtion')),
    description: description === 'NULL' ? null : description,
    active: cellText(vrSheet, r, col('IsActive')) === 'Active',
    severity: cellText(vrSheet, r, col('Severity')),
    fromReferenceDate: isoDate(cellText(vrSheet, r, col('FromReferenceDate'))),
    toReferenceDate: isoDate(cellText(vrSheet, r, col('ToReferenceDate'))),
    fromSubmissionDate: isoDate(cellText(vrSheet, r, col('FromSubmissionDate'))),
    implementedInXbrl: cellText(vrSheet, r, col('Implemented in XBRL')) === 'Yes',
    parseError: parsed.ok ? null : parsed.reason,
  });
}

// ---------------------------------------------------------------- ESA checks overview
const chkBook = await readXlsx(await source('esas-roi-checks'), nodeCodec);
const checks: unknown[] = [];
const external: unknown[] = [];
for (const sheet of chkBook.sheets) {
  const rowsSorted = [...sheet.rows.keys()].sort((a, b) => a - b);
  if (sheet.name === 'Technical checks' || sheet.name === 'DPM Technical Checks') {
    for (const r of rowsSorted) {
      const code = cellText(sheet, r, 1);
      if (!/^[0-9]{3}$/.test(code)) continue;
      checks.push({ code, category: cellText(sheet, r, 2), description: cellText(sheet, r, 3), comment: cellText(sheet, r, 4) || null, layer: sheet.name === 'Technical checks' ? 'technical' : 'dpm-technical' });
    }
  } else if (sheet.name.startsWith('LEI')) {
    for (const r of rowsSorted) {
      const code = cellText(sheet, r, 1);
      if (!/^VR_[0-9]+$/.test(code)) continue;
      external.push({
        code,
        type: cellText(sheet, r, 3),
        table: cellText(sheet, r, 4).replace(/^b_(\d\d)_(\d\d)$/, 'B_$1.$2'),
        column: cellText(sheet, r, 6),
        description: cellText(sheet, r, 11),
        prerequisite: cellText(sheet, r, 12) || null,
      });
    }
  }
}

// ---------------------------------------------------------------- EBA sample package (test fixture)
const samples = openZip(await source('eba-sample-instances-4.0'), nodeCodec, BIG);
const csvInstances = await nested(samples, 'instances xBRL-CSV.zip');
const doraSample = csvInstances.entries.find((e) => /DORA010100_DORA_.*\.zip$/.test(e.name));
if (doraSample === undefined) throw new Error('DORA sample not found');
const fixtureDir = join(ROOT, 'test/fixtures/eba');
await mkdir(fixtureDir, { recursive: true });
await writeFile(join(fixtureDir, doraSample.name.split('/').pop() ?? 'sample.zip'), await csvInstances.read(doraSample));

// ---------------------------------------------------------------- output
const doc = moduleJson.documentInfo['eba:documentation'];
const out = {
  format: 1,
  framework: {
    code: 'DORA',
    release: '4.0',
    releaseLabel: 'EBA reporting framework 4.0, taxonomy package errata 5 (21 March 2025)',
    module: 'dora',
    moduleVersion: doc.ModuleVersion,
    fromReferenceDate: doc.FromReferenceDate,
    toReferenceDate: doc.toReferenceDate === 'None' ? null : doc.toReferenceDate,
    entryPoint: 'http://www.eba.europa.eu/eu/fr/xbrl/crr/fws/dora/4.0/mod/dora.json',
    reportDocumentType: moduleJson.documentInfo.extends.length > 0 ? 'https://xbrl.org/2021/xbrl-csv' : '',
    dimensions: moduleJson.dimensions,
    jsonParameters: moduleJson.parameters,
    filingIndicatorTable: Object.values(moduleJson.tables).find((t) => t.template === 'FilingIndicators')?.url ?? 'FilingIndicators.csv',
  },
  templates,
  enumerations: Object.fromEntries([...enumSets].sort((a, b) => a[0].localeCompare(b[0]))),
  labels: Object.fromEntries(Object.entries(memberLabels).sort((a, b) => a[0].localeCompare(b[0]))),
  rules,
  checks,
  externalChecks: external,
  sources: manifest.sources.map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, url: s.url, humanUrl: s.humanUrl, sha256: s.sha256, bytes: s.bytes })),
};
await mkdir(join(ROOT, 'src/data'), { recursive: true });
await writeFile(join(ROOT, 'src/data/dora-4.0.json'), `${JSON.stringify(out, null, 1)}\n`);
await writeFile(join(ROOT, 'src/data/column-mapping.txt'), `${mappingLog.join('\n')}\n`);
process.stdout.write(`templates ${templates.length}, enumerations ${enumSets.size}, labels ${usedMembers.size}, rules ${rules.length}, checks ${checks.length}, external ${external.length}\n`);
for (const r of rules as { code: string; parseError: string | null }[]) if (r.parseError !== null) process.stdout.write(`  rule ${r.code} not parsed: ${r.parseError}\n`);
