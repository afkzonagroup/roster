// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy } from '../taxonomy/types.ts';
import { LINKS, type LinkKey } from './sources.ts';

/** How Roster handles a rule. */
export type Coverage = 'checked' | 'not-checked' | 'not-applicable' | 'by-construction';

/** Everything Roster knows about one rule. */
export interface RuleInfo {
  readonly id: string;
  readonly title: string;
  /** Who sets the rule. */
  readonly origin: string;
  readonly coverage: Coverage;
  /** What Roster does, or why it does not check the rule. */
  readonly how: string;
  readonly links: readonly { readonly title: string; readonly url: string }[];
  /** The official expression or wording, when there is one. */
  readonly expression?: string;
  readonly severity?: string;
  readonly status?: string;
}

const L = (...keys: LinkKey[]): { title: string; url: string }[] => keys.map((k) => ({ ...LINKS[k] }));

/** Rules that Roster defines from the ITS, xBRL and EBA texts. */
const OWN: readonly Omit<RuleInfo, 'coverage'>[] = [
  {
    id: 'its.lei',
    title: 'LEI structure and check digits',
    origin: 'ITS Article 3(5) and the column instructions ("LEI, 20-character, alpha-numeric code based on the ISO 17442 standard")',
    how: 'Checks 18 upper-case letters or digits plus 2 check digits, and the ISO 7064 MOD 97-10 check (remainder 1). Applies to the LEI columns of the ITS and to identification codes whose type of code is LEI. Whether the LEI is issued and active needs the GLEIF database (ESAs checks VR_2, VR_12, VR_23, VR_71, VR_77), which Roster does not contact.',
    links: L('its', 'checks'),
  },
  {
    id: 'its.euid',
    title: 'EUID structure',
    origin: 'ITS Article 3(5) and B_05.01.0010; Implementing Regulation (EU) 2021/1042, Annex, point 9; ESAs DORA FAQ question 45',
    how: 'When the type of code is EUID: two letters (country), a register identifier, a dot, and the registration number. Whether the EUID exists needs BRIS (ESAs checks VR_72, VR_78), which Roster does not contact.',
    links: L('its', 'euid', 'faq'),
  },
  {
    id: 'its.mandatory',
    title: 'Mandatory column is empty',
    origin: 'ITS Annex I, "Fill-in Option" of each column ("Mandatory", "Mandatory in case of reporting")',
    how: 'Warns when a column the ITS marks "Mandatory" is empty (and "Mandatory in case of reporting" when packaging). Conditional wording ("Mandatory if ...") is shown by `roster explain` but only checked where an official validation rule encodes it. The ESAs FAQ (question 26) says mandatory fields that cannot be filled may be left empty and will be flagged as data quality issues, except key columns.',
    links: L('its', 'faq'),
  },
  {
    id: 'its.natural-number',
    title: 'Natural number',
    origin: 'ITS Annex I, column type "Natural number"',
    how: 'Integers below zero are rejected in columns the ITS types as natural numbers.',
    links: L('its'),
  },
  {
    id: 'its.rank',
    title: 'Rank of a provider in the supply chain',
    origin: 'ITS Article 2: the rank is a natural number of 1 or more; the direct provider has rank 1',
    how: 'B_05.02 c0050 must be 1 or more.',
    links: L('its'),
  },
  {
    id: 'its.function-identifier',
    title: 'Function identifier',
    origin: 'ITS Annex I, B_06.01.0010: "the letter F (capital letter) followed by a natural number"',
    how: 'B_06.01 c0010 must match F followed by digits.',
    links: L('its'),
  },
  {
    id: 'its.max-length',
    title: 'Maximum length stated in the ITS',
    origin: 'ITS Annex I, B_06.01.0070 (taxonomy c0060): "300 characters maximum"',
    how: 'Counts characters (Unicode code points).',
    links: L('its'),
  },
  {
    id: 'xbrl-csv.character',
    title: 'Character not allowed in xBRL-CSV',
    origin: 'xBRL-CSV 1.0 section 3.2.1 (TEXTDATA)',
    how: 'Rejects C0 control characters other than tab, CR and LF, lone surrogates, U+FFFE and U+FFFF.',
    links: L('xbrlCsv'),
  },
  {
    id: 'xbrl-csv.special-value',
    title: 'xBRL-CSV special value',
    origin: 'xBRL-CSV 1.0 section 3.2.4',
    how: 'In a report package a cell starting with # must be ##... (literal #) or a special value. Roster writes values starting with # as ## (xBRL-CSV), but the EBA does not accept such values at all (rule eba-fr.csv-special).',
    links: L('xbrlCsv'),
  },
  {
    id: 'eba-fr.csv-special',
    title: 'Value starting with #',
    origin: 'EBA filing rules v5.9, "xBRL-CSV reports extra rules", rule 5: special values and "any value started with #" must not be used in fact or key columns',
    how: 'Every value of the register that starts with # is an error, also when it would be written escaped as ##.',
    links: L('filingRules'),
  },
  { id: 'xbrl-csv.invalidParameterCSVFile', title: 'Invalid parameters.csv', origin: 'xBRL-CSV 1.0 section 3.1.13', how: 'Each row: a unique name and a non-empty value, nothing else.', links: L('xbrlCsv') },
  { id: 'xbrl-csv.unreferencedParameter', title: 'Parameter not used by the module', origin: 'xBRL-CSV 1.0 section 3.2.6; EBA filing rules v5.9, xBRL-CSV reports (b)', how: 'Only entityID, refPeriod, baseCurrency, decimalsInteger and decimalsMonetary are allowed.', links: L('xbrlCsv', 'filingRules') },
  { id: 'eba-fr.1.5', title: 'Entry point only through extends', origin: 'EBA filing rule 1.5(a)', how: 'report.json must not populate documentInfo/taxonomy.', links: L('filingRules') },
  { id: 'eba-fr.1.6', title: 'Filing indicator for every template', origin: 'EBA filing rule 1.6(d)', how: 'Every template of the module needs a filing indicator; Roster writes all of them as true.', links: L('filingRules') },
  { id: 'eba-fr.2.18', title: 'Decimals', origin: 'EBA filing rule 2.18: monetary decimals >= -4 for submissions from 1 April 2025, integers 0', how: 'Checks the decimalsMonetary and decimalsInteger parameters.', links: L('filingRules') },
  { id: 'eba-fr.2.19', title: 'No nil or empty facts', origin: 'EBA filing rule 2.19', how: '#nil and #empty must not be reported.', links: L('filingRules') },
  {
    id: 'roster.whitespace',
    title: 'Leading or trailing spaces',
    origin: 'Roster data quality check (keys are compared exactly: xBRL-CSV table constraints use XML Schema equality)',
    how: 'Warns; the value is kept as it is.',
    links: L('tableConstraints'),
  },
  {
    id: 'roster.formula-like',
    title: 'Value that a spreadsheet could run as a formula',
    origin: 'Roster safety check (CSV formula injection)',
    how: 'Warns about text values starting with =, +, - or @. The value is reported exactly as it is; Roster never changes report data.',
    links: [],
  },
  {
    id: 'roster.suspicious-character',
    title: 'Invisible, bidirectional or C1 control character',
    origin: 'Roster safety check',
    how: 'Warns about characters that make a value look different from what it is.',
    links: [],
  },
  { id: 'roster.settings', title: 'Report settings', origin: 'EBA filing rules v5.9 (parameters) and the ESAs FAQ question 24 (file name)', how: 'Checks LEI, consolidation, country, reference date and base currency of the report.', links: L('filingRules', 'faq') },
  { id: 'rp.invalidDirectoryStructure', title: 'Single top-level folder', origin: 'Report Package 1.0 section 4.1', how: 'Checked when reading a package.', links: L('reportPackage') },
  { id: 'rp.missingReportPackageJson', title: 'META-INF/reportPackage.json', origin: 'Report Package 1.0 section 4.4; EBA filing rules v5.9 (package structure)', how: 'Checked when reading a package.', links: L('reportPackage', 'filingRules') },
  { id: 'rp.unsupportedReportPackageVersion', title: 'Report package document type', origin: 'Report Package 1.0 section 4.4', how: 'A .zip package declares https://xbrl.org/report-package/2023.', links: L('reportPackage') },
  { id: 'rp.invalidJSON', title: 'Invalid JSON', origin: 'Report Package 1.0 section 9', how: 'Checked when reading a package.', links: L('reportPackage') },
  { id: 'rp.missingReportsDirectory', title: 'reports folder', origin: 'Report Package 1.0 section 4.7', how: 'Checked when reading a package.', links: L('reportPackage') },
  { id: 'import.duplicate-template', title: 'Template given twice', origin: 'Roster import', how: 'Two files or sheets for one template; only the first is used.', links: [] },
  { id: 'import.formula', title: 'Formula cells', origin: 'Roster importer, security', how: 'Formulas are never evaluated. The value saved in the workbook is used and reported, or rejected with --reject-formulas.', links: [] },
  { id: 'import.cell-error', title: 'Excel error value', origin: 'Roster import', how: 'Cells holding #N/A, #REF! and similar are not imported.', links: [] },
  { id: 'import.outside-columns', title: 'Values outside the coded columns', origin: 'Roster import', how: 'Values in columns without a column code header are not read; they are reported so nothing is lost silently.', links: [] },
  { id: 'import.draft-template', title: 'Draft RT templates', origin: 'Roster import', how: 'The 2024 dry run used draft "RT" templates with different columns; they are not accepted.', links: L('preparation') },
  { id: 'import.ignored-sheets', title: 'Sheets ignored', origin: 'Roster import', how: 'Sheets not named after a template are listed and skipped.', links: [] },
  { id: 'import.converted', title: 'Values converted', origin: 'Roster import', how: 'Labels and ISO codes are converted to taxonomy codes where unambiguous; numbers in scientific notation are expanded exactly.', links: [] },
  { id: 'import.too-large', title: 'File too large', origin: 'Roster importer, size limit', how: 'Files above the size limit are not read.', links: [] },
];

/** ESAs technical checks Roster does not or cannot run, with the reason. */
const NOT_CHECKED: Readonly<Record<string, { coverage: Coverage; how: string }>> = {
  '102': { coverage: 'not-checked', how: 'Transport limit of the ESAs SFTP channel (10 GB); not relevant offline.' },
  '107': { coverage: 'not-checked', how: 'Depends on the competent authority submission path, which Roster does not know.' },
  '110': { coverage: 'not-checked', how: 'Needs the history of earlier submissions.' },
  '332': { coverage: 'not-applicable', how: 'The DORA module has no boolean metrics (its data types are text, closed list, date, integer, monetary and true-only Link columns; see 333).' },
  '512': { coverage: 'by-construction', how: 'Roster only uses the DORA 4.0 module, which has FromDate 2025-03-31 and no ToDate.' },
  '803': { coverage: 'not-applicable', how: 'All DORA templates are open tables in the taxonomy; there are no closed-table row identifiers.' },
  '804': { coverage: 'not-applicable', how: 'All DORA templates are open tables in the taxonomy; there are no closed-table row identifiers.' },
};

/** How Roster covers each ESAs check it runs. */
const ESA_HOW: Readonly<Record<string, string>> = {
  '101': 'File name ends with .zip (package reader); the writer always uses .zip.',
  '103': 'ZIP structure, sizes and CRC-32 are verified on reading.',
  '104': 'File name characters (package reader); the writer builds the name from validated parts.',
  '105': 'File name structure and top-level folder name (package reader); the writer builds the name.',
  '106': 'Framework code, module version and module in the file name.',
  '109': 'Reference date format.',
  '111': 'Reference date not after today.',
  '115': 'The writer produces only plain-csv (xBRL-CSV) packages; the reader checks the structure.',
  '306': 'Every file is decoded as strict UTF-8; invalid bytes are rejected.',
  '701': 'report.json, FilingIndicators.csv and parameters.csv exist and are not empty.',
  '702': 'FilingIndicators.csv has two columns.',
  '703': 'Each template once in FilingIndicators.csv.',
  '704': 'Filing indicator values are booleans.',
  '705': 'Filing indicator values are present.',
  '714': 'entityID exists and matches the file name.',
  '720': 'Table file names are template file names of the module.',
  '723': 'parameters.csv header is name,value.',
  '724': 'At least one data row in the register.',
  '801': 'Every header is a column code of the template in the taxonomy.',
  '802': 'No column twice in a header.',
  '805': 'Key columns are never empty.',
  '806': 'No two rows of a template with the same key values (a template without key columns can have one row).',
  '807': 'Every reference key of the taxonomy (tc:keys) matches a row of the target template. Rows whose reference columns are all empty are not checked.',
  '808': 'The writer reports every template as true; the reader flags false.',
  '809': 'CSV is parsed strictly per RFC 4180 as amended by xBRL-CSV 1.0.',
  '305': 'Monetary values must be numbers (xs:decimal).',
  '320': 'refPeriod is a valid date and equals the reference date in the file name.',
  '330': 'Dates are yyyy-mm-dd and real calendar dates.',
  '331': 'Integers are integers.',
  '333': 'Link columns hold true; the writer fills them.',
  '503': 'Closed-list columns hold a code of the taxonomy list.',
  '505': 'report.json extends exactly the DORA 4.0 entry point.',
  '510': 'Filing indicator codes are templates of the module.',
  '514': 'entityID has the .CON or .IND qualifier.',
};

/** Information about a rule id, or undefined when Roster does not know it. */
export function describeRule(id: string, taxonomy: Taxonomy = DORA_4_0): RuleInfo | undefined {
  const own = OWN.find((r) => r.id === id);
  if (own !== undefined) return { ...own, coverage: 'checked' };
  const esa = /^esa\.([0-9]{3})$/.exec(id);
  if (esa !== null) {
    const code = esa[1] ?? '';
    const c = taxonomy.checks.find((x) => x.code === code);
    if (c === undefined) return undefined;
    const nc = NOT_CHECKED[code];
    return {
      id,
      title: c.description,
      origin: `ESAs ${c.layer === 'technical' ? 'technical check' : 'DPM technical check'} ${code} (${c.category})${c.comment !== null ? `. ${c.comment}` : ''}`,
      coverage: nc?.coverage ?? 'checked',
      how: nc?.how ?? ESA_HOW[code] ?? 'Checked.',
      links: L('checks', 'faq'),
    };
  }
  const rule = taxonomy.rules.find((r) => r.code === id);
  if (rule !== undefined) {
    return {
      id,
      title: rule.description ?? `${rule.source} rule on ${rule.tables.join(', ')}`,
      origin: `EBA validation rule (${rule.source}, framework DORA, module ${rule.module}, tables ${rule.tables.join(', ')})`,
      coverage: rule.parseError !== null ? 'not-checked' : 'checked',
      how: rule.parseError !== null
        ? `Not evaluated: ${rule.parseError}.`
        : `Evaluated row by row from the official DPM-XL expression${rule.active ? '' : ' only with --include-inactive (the EBA has deactivated this rule)'}. Rows where all columns the rule reads are empty are skipped.`,
      expression: rule.precondition !== '' ? `${rule.expression}   [precondition ${rule.precondition}]` : rule.expression,
      severity: rule.severity,
      status: `${rule.active ? 'active' : 'deactivated'}; reference dates from ${rule.fromReferenceDate ?? '-'}${rule.toReferenceDate !== null ? ` to ${rule.toReferenceDate}` : ''}; submissions from ${rule.fromSubmissionDate ?? '-'}`,
      links: L('validationRules', 'checks'),
    };
  }
  const ext = taxonomy.externalChecks.find((r) => r.code === id);
  if (ext !== undefined) {
    return {
      id,
      title: `${ext.type}: ${ext.table} ${ext.column}`,
      origin: `ESAs business check ${ext.code} against an external database`,
      coverage: 'not-checked',
      how: `${ext.description}${ext.prerequisite !== null ? ` (when ${ext.prerequisite})` : ''}. Roster works offline and does not contact GLEIF or BRIS; it checks the LEI format and check digits (its.lei) and the EUID structure (its.euid) instead.`,
      links: L('checks'),
    };
  }
  return undefined;
}

/** Every rule id Roster can explain. */
export function allRuleIds(taxonomy: Taxonomy = DORA_4_0): string[] {
  return [
    ...OWN.map((r) => r.id),
    ...taxonomy.checks.map((c) => `esa.${c.code}`),
    ...taxonomy.rules.map((r) => r.code),
    ...taxonomy.externalChecks.map((r) => r.code),
  ];
}
