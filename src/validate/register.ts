// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { Register, RegisterRow } from '../model/register.ts';
import { DORA_4_0, allowedValues } from '../taxonomy/dora.ts';
import type { Column, Taxonomy, Template } from '../taxonomy/types.ts';
import { hasC1Control, hasForbiddenCharacter, hasInvisibleCharacter, printable } from '../util/text.ts';
import { parseDpmXl, type ParsedRule } from './dpmxl.ts';
import { checkEvaluable, evaluateRule } from './evaluate.ts';
import { FindingSink, type Finding, type Severity } from './finding.ts';
import { checkEuid, checkLei } from './identifiers.ts';
import { canonicalInteger, isDecimal, isInteger, isIsoDate } from './values.ts';

/** Options for {@link validateRegister}. */
export interface ValidateOptions {
  /**
   * The register is being reported: columns the ITS marks "Mandatory in
   * case of reporting" (B_01.01.0050, B_01.01.0060) are then mandatory too.
   */
  readonly reporting?: boolean;
  /** Reference date of the report; official rules apply only within their reference date range. */
  readonly referenceDate?: string;
  /** Also run official rules that the EBA has deactivated. Off by default. */
  readonly includeInactiveRules?: boolean;
  /** Stop collecting findings after this many (default 10 000). */
  readonly maxFindings?: number;
  readonly taxonomy?: Taxonomy;
}

/** An official rule Roster does not evaluate, with the reason. */
export interface NotEvaluated {
  readonly rule: string;
  readonly reason: string;
}

/** Result of validating a register. */
export interface RegisterValidation {
  readonly findings: readonly Finding[];
  /** Findings dropped after `maxFindings` was reached. */
  readonly truncated: number;
  /** Official rules (validation rules and external checks) that were not run, with why. */
  readonly notEvaluated: readonly NotEvaluated[];
  /** Official validation rules that were run. */
  readonly rulesRun: readonly string[];
}

const TYPE_RULE: Record<string, string> = { d: 'esa.330', i: 'esa.331', m: 'esa.305', t: 'esa.333', e: 'esa.503' };

function keyOf(template: Template, row: RegisterRow, columns: readonly string[]): string {
  return JSON.stringify(
    columns.map((c) => {
      const v = row.values[c] ?? '';
      const col = template.columns.find((x) => x.code === c);
      return col?.type === 'i' ? canonicalInteger(v) : v;
    }),
  );
}

interface Ctx {
  readonly sink: FindingSink;
  readonly taxonomy: Taxonomy;
  readonly options: ValidateOptions;
}

function finding(ctx: Ctx, rule: string, severity: Severity, message: string, at: { template: Template; row?: number; r?: RegisterRow; column?: Column; value?: string }): void {
  const f: Finding = {
    rule,
    severity,
    message,
    template: at.template.code,
    ...(at.column !== undefined ? { column: at.column.code } : {}),
    ...(at.row !== undefined ? { row: at.row } : {}),
    ...(at.r !== undefined ? { source: at.r.origin.source, line: at.r.origin.line } : {}),
    ...(at.value !== undefined ? { value: printable(at.value, 80) } : {}),
  };
  ctx.sink.add(f);
}

/** Length in Unicode code points (the ITS counts characters, not UTF-16 units). */
function codePoints(value: string): number {
  return value.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '_').length;
}

function columnName(c: Column): string {
  return c.its !== null ? `${c.its.code} ${c.its.name}` : `${c.code} ${c.label}`;
}

function checkCell(ctx: Ctx, template: Template, column: Column, value: string, at: { row: number; r: RegisterRow }): void {
  const where = { template, column, value, ...at };
  if (hasForbiddenCharacter(value)) {
    finding(ctx, 'xbrl-csv.character', 'error', `${columnName(column)}: contains a control character that xBRL-CSV does not allow.`, where);
    return;
  }
  if (hasC1Control(value) || hasInvisibleCharacter(value)) {
    finding(ctx, 'roster.suspicious-character', 'warning', `${columnName(column)}: contains an invisible, bidirectional or control character.`, where);
  }
  if (value.startsWith('#')) {
    finding(ctx, 'eba-fr.csv-special', 'error', `${columnName(column)}: starts with "#". The EBA filing rules (xBRL-CSV reports extra rule 5) do not allow any value starting with # in a fact or key column, even escaped as ##.`, where);
  }
  if (value !== value.trim()) {
    finding(ctx, 'roster.whitespace', 'warning', `${columnName(column)}: leading or trailing spaces. Keys are compared exactly, so "A " and "A" are different.`, where);
  }
  if (column.type === 's' && /^[\s\u3000]*[=+\-@\uff1d\uff0b\uff0d\uff20]/.test(value) && !/^-?[0-9]+(\.[0-9]+)?$/.test(value)) {
    finding(ctx, 'roster.formula-like', 'warning', `${columnName(column)}: starts like a spreadsheet formula. People who open the report in a spreadsheet could run it.`, where);
  }
  switch (column.type) {
    case 'e': {
      const allowed = allowedValues(column, ctx.taxonomy);
      if (!allowed.includes(value)) {
        finding(ctx, 'esa.503', 'error', `${columnName(column)}: "${printable(value, 40)}" is not in the closed list of the taxonomy (${allowed.length} codes, e.g. ${allowed.slice(0, 2).join(', ')}).`, where);
      }
      break;
    }
    case 'd':
      if (!isIsoDate(value)) finding(ctx, TYPE_RULE.d ?? '', 'error', `${columnName(column)}: not a date in the form yyyy-mm-dd.`, where);
      break;
    case 'i':
      if (!isInteger(value)) finding(ctx, TYPE_RULE.i ?? '', 'error', `${columnName(column)}: not an integer.`, where);
      else if (column.its?.type === 'Natural number' && value.startsWith('-') && canonicalInteger(value) !== '0') {
        finding(ctx, 'its.natural-number', 'error', `${columnName(column)}: the ITS asks for a natural number (0 or more).`, where);
      }
      break;
    case 'm':
      if (!isDecimal(value)) finding(ctx, TYPE_RULE.m ?? '', 'error', `${columnName(column)}: not a number. Use digits and a point, no thousands separators, no currency symbol, in units.`, where);
      break;
    case 't':
      if (value !== 'true') finding(ctx, TYPE_RULE.t ?? '', 'error', `${columnName(column)}: this "Link" column only takes the value true.`, where);
      break;
    default:
      break;
  }
  if (column.maxLength !== null && codePoints(value) > column.maxLength) {
    finding(ctx, 'its.max-length', 'error', `${columnName(column)}: longer than ${column.maxLength} characters (ITS instruction).`, where);
  }
  if (column.lei) {
    const p = checkLei(value);
    // Where the ITS allows "the LEI ... or the EUID" (B_03.01.0020), a value with the EUID structure is accepted.
    if (p !== null && !(column.euid && checkEuid(value))) finding(ctx, 'its.lei', 'error', `${columnName(column)}: ${p === 'format' ? 'not an LEI (20 characters: 18 upper-case letters or digits and 2 check digits)' : 'LEI check digits are wrong (ISO 17442, ISO 7064 MOD 97-10)'}${column.euid ? '; an EUID is also accepted here' : ''}.`, where);
  }
  if (template.code === 'B_06.01' && column.code === 'c0010' && !/^F[0-9]+$/.test(value)) {
    finding(ctx, 'its.function-identifier', 'error', `${columnName(column)}: the ITS asks for the letter F followed by a natural number, e.g. F1.`, where);
  }
  if (template.code === 'B_05.02' && column.code === 'c0050' && isInteger(value) && Number(value) < 1) {
    finding(ctx, 'its.rank', 'error', `${columnName(column)}: the rank is a natural number of 1 or more; the direct provider has rank 1 (ITS Article 2).`, where);
  }
}

function checkIdentifierPairs(ctx: Ctx, template: Template, row: RegisterRow, n: number): void {
  for (const typeCol of template.columns) {
    if (typeCol.identifies === null) continue;
    const type = row.values[typeCol.code];
    const idCol = template.columns.find((c) => c.code === typeCol.identifies);
    const id = idCol === undefined ? undefined : row.values[idCol.code];
    if (idCol === undefined || type === undefined || id === undefined || id === '') continue;
    if (type === 'eba_qCO:qx2000') {
      const p = checkLei(id);
      if (p !== null) {
        finding(ctx, 'its.lei', 'error', `${columnName(idCol)}: the type of code is LEI, but ${p === 'format' ? 'the value is not an LEI' : 'the LEI check digits are wrong'}.`, { template, column: idCol, value: id, row: n, r: row });
      }
    } else if (type === 'eba_qCO:qx2002' && !checkEuid(id)) {
      finding(ctx, 'its.euid', 'warning', `${columnName(idCol)}: the type of code is EUID, but the value does not have the EUID structure (country code, register identifier, a dot, registration number).`, { template, column: idCol, value: id, row: n, r: row });
    }
  }
}

/** Parsed official rules, cached per taxonomy. */
const parsedRules = new WeakMap<Taxonomy, Map<string, ParsedRule | string>>();
function ruleAst(taxonomy: Taxonomy, code: string, expression: string): ParsedRule | string {
  let cache = parsedRules.get(taxonomy);
  if (cache === undefined) {
    cache = new Map();
    parsedRules.set(taxonomy, cache);
  }
  let r = cache.get(code);
  if (r === undefined) {
    const p = parseDpmXl(expression);
    r = p.ok ? p.rule : p.reason;
    cache.set(code, r);
  }
  return r;
}

/**
 * Validates a register of information against the DORA taxonomy 4.0, the
 * ITS (Implementing Regulation (EU) 2024/2956) and the EBA validation rules
 * that can be evaluated locally. See `roster explain <rule>` for every rule.
 *
 * @example
 * ```ts
 * const result = validateRegister(register, { reporting: true, referenceDate: '2025-12-31' });
 * for (const f of result.findings) console.log(f.rule, f.message);
 * ```
 */
export function validateRegister(register: Register, options: ValidateOptions = {}): RegisterValidation {
  const taxonomy = options.taxonomy ?? DORA_4_0;
  const sink = new FindingSink(options.maxFindings ?? 10_000);
  const ctx: Ctx = { sink, taxonomy, options };
  const primaryIndex = new Map<string, Set<string>>();

  for (const template of taxonomy.templates) {
    const table = register.tables.get(template.code);
    const rows = table?.rows ?? [];
    const seen = new Map<string, number>();
    const index = new Set<string>();
    rows.forEach((row, i) => {
      const n = i + 1;
      for (const column of template.columns) {
        const value = row.values[column.code];
        if (value === undefined || value === '') {
          if (column.key) {
            finding(ctx, 'esa.805', 'error', `${columnName(column)}: key column is empty. Keys must always be filled; the ESAs' FAQ asks for "Not applicable" where a key does not apply.`, { template, column, row: n, r: row });
          } else if (column.its?.status === 'mandatory' || (column.its?.status === 'reporting' && options.reporting === true)) {
            finding(ctx, 'its.mandatory', 'warning', `${columnName(column)}: mandatory in the ITS but empty.`, { template, column, row: n, r: row });
          }
          continue;
        }
        checkCell(ctx, template, column, value, { row: n, r: row });
      }
      for (const code of Object.keys(row.values)) {
        if (!template.columns.some((c) => c.code === code)) {
          finding(ctx, 'esa.801', 'error', `Column ${printable(code, 20)} is not defined for ${template.code} in the taxonomy.`, { template, row: n, r: row });
        }
      }
      checkIdentifierPairs(ctx, template, row, n);
      const key = keyOf(template, row, template.primaryKey);
      const first = seen.get(key);
      if (first !== undefined) {
        finding(ctx, 'esa.806', 'error', `Same key values as row ${first}${template.primaryKey.length === 0 ? ' (this template has no key columns, so it can have only one row)' : ` (key columns ${template.primaryKey.join(', ')})`}.`, { template, row: n, r: row });
      } else seen.set(key, n);
      index.add(key);
    });
    primaryIndex.set(template.code, index);
  }

  // Reference (foreign) keys declared in the taxonomy (EBA check 807).
  for (const template of taxonomy.templates) {
    const rows = register.tables.get(template.code)?.rows ?? [];
    for (const ref of template.references) {
      const target = taxonomy.templates.find((t) => t.code === ref.target);
      const targetIndex = primaryIndex.get(ref.target);
      if (target === undefined || targetIndex === undefined) continue;
      rows.forEach((row, i) => {
        const local = ref.columns.map((c) => row.values[c] ?? '');
        if (local.every((v) => v === '')) return;
        const typed = local.map((v, k) => (target.columns.find((c) => c.code === target.primaryKey[k])?.type === 'i' ? canonicalInteger(v) : v));
        if (!targetIndex.has(JSON.stringify(typed))) {
          finding(ctx, 'esa.807', 'error', `${ref.columns.join(' + ')} = ${local.map((v) => `"${printable(v, 40)}"`).join(' + ')} has no matching row in ${ref.target} (${target.primaryKey.join(' + ')}). Taxonomy key "${ref.name}".`, { template, row: i + 1, r: row });
        }
      });
    }
  }

  // Official EBA validation rules (DPM-XL).
  const notEvaluated: NotEvaluated[] = [];
  const rulesRun: string[] = [];
  const refDate = options.referenceDate;
  for (const rule of taxonomy.rules) {
    if (!rule.active && options.includeInactiveRules !== true) {
      notEvaluated.push({ rule: rule.code, reason: 'deactivated by the EBA (run with --include-inactive to evaluate)' });
      continue;
    }
    if (refDate !== undefined && ((rule.fromReferenceDate !== null && refDate < rule.fromReferenceDate) || (rule.toReferenceDate !== null && refDate > rule.toReferenceDate))) {
      notEvaluated.push({ rule: rule.code, reason: `does not apply to reference date ${refDate}` });
      continue;
    }
    const ast = ruleAst(taxonomy, rule.code, rule.expression);
    const tableCode = typeof ast === 'string' ? undefined : (ast.table ?? rule.tables[0]);
    const template = tableCode === undefined ? undefined : taxonomy.templates.find((t) => t.code === tableCode);
    const reason = typeof ast === 'string' ? `expression outside the supported DPM-XL subset: ${ast}` : template === undefined ? 'table not found' : checkEvaluable(ast, template);
    if (typeof ast === 'string' || template === undefined || reason !== null) {
      notEvaluated.push({ rule: rule.code, reason: reason ?? 'not evaluable' });
      continue;
    }
    rulesRun.push(rule.code);
    const existence = rule.source === 'existence';
    const severity: Severity = rule.severity === 'error' ? 'error' : 'warning';
    (register.tables.get(template.code)?.rows ?? []).forEach((row, i) => {
      for (const failure of evaluateRule(ast, template, row.values, existence)) {
        const col = failure.column === null ? undefined : template.columns.find((c) => c.code === failure.column);
        finding(ctx, rule.code, severity, `Official validation rule ${rule.code}${rule.active ? '' : ' (deactivated)'} fails: ${rule.expression}${col !== undefined ? ` [column ${col.code}]` : ''}`, {
          template,
          row: i + 1,
          r: row,
          ...(col !== undefined ? { column: col } : {}),
        });
      }
    });
  }
  for (const ext of taxonomy.externalChecks) {
    notEvaluated.push({ rule: ext.code, reason: `${ext.description} (needs an external database; Roster checks the format and check digits locally instead)` });
  }
  return { findings: sink.findings, truncated: sink.truncated, notEvaluated, rulesRun };
}
