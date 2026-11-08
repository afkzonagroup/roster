// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { Register, RegisterRow } from '../model/register.ts';
import { makeRegister } from '../model/register.ts';
import type { Taxonomy, Template } from '../taxonomy/types.ts';
import type { Finding } from '../validate/finding.ts';
import { printable } from '../util/text.ts';
import { normaliseValue, parseHeader } from './normalize.ts';
import { unneutraliseFormula } from './working.ts';

/** Result of an import: the register and what the importer noticed. */
export interface ImportResult {
  readonly register: Register;
  /** Problems with the input itself (unknown sheets or columns, formulas, conversions). */
  readonly findings: readonly Finding[];
}

/** Collects rows per template while importing. */
export class RegisterBuilder {
  readonly rows = new Map<string, RegisterRow[]>();
  readonly findings: Finding[] = [];
  readonly sources = new Map<string, string>();
  conversions = 0;
  private readonly taxonomy: Taxonomy;
  /** Values are xBRL-CSV cells of a report package: special values apply and nothing is converted. */
  private readonly xbrlCsv: boolean;

  constructor(taxonomy: Taxonomy, xbrlCsv = false) {
    this.taxonomy = taxonomy;
    this.xbrlCsv = xbrlCsv;
  }

  /** Registers the source of a template; a second source for the same template is an error. */
  claim(template: string, source: string): boolean {
    const prev = this.sources.get(template);
    if (prev !== undefined) {
      this.findings.push({ rule: 'import.duplicate-template', severity: 'error', message: `${template} appears twice: in ${printable(prev)} and in ${printable(source)}. Only the first is used.`, template, source });
      return false;
    }
    this.sources.set(template, source);
    return true;
  }

  /**
   * Maps header cells to column codes. Returns the codes by position, or
   * null when the header is unusable (errors are recorded).
   */
  header(template: Template, cells: readonly string[], source: string, line: number): (string | null)[] | null {
    const out: (string | null)[] = [];
    const seen = new Set<string>();
    let ok = true;
    for (const [i, text] of cells.entries()) {
      if (text.trim() === '') {
        out.push(null);
        continue;
      }
      const h = parseHeader(text, template.code);
      if (h === null || typeof h === 'object' || !template.columns.some((c) => c.code === h)) {
        const hint =
          template.code === 'B_06.01' && /0110$/.test(text.trim())
            ? ' The taxonomy numbers B_06.01 consecutively (0050 to 0100); the Official Journal text skips 0050 (ESAs DORA FAQ 46). Renumber the columns.'
            : '';
        this.findings.push({
          rule: 'esa.801',
          severity: 'error',
          message: `Column ${i + 1} header "${printable(text, 40)}" is not a column of ${template.code}${typeof h === 'object' && h !== null ? ` (${h.error})` : ''}.${hint}`,
          template: template.code,
          source,
          line,
        });
        ok = false;
        out.push(null);
        continue;
      }
      if (seen.has(h)) {
        this.findings.push({ rule: 'esa.802', severity: 'error', message: `Column ${h} appears twice in the header.`, template: template.code, column: h, source, line });
        ok = false;
      }
      seen.add(h);
      out.push(h);
    }
    return ok ? out : null;
  }

  /** Adds a data row; values are normalised for their column. */
  add(template: Template, values: ReadonlyMap<string, string>, source: string, line: number): void {
    const out: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [code, raw] of values) {
      const column = template.columns.find((c) => c.code === code);
      if (column === undefined || raw === '') continue;
      if (this.xbrlCsv) {
        // xBRL-CSV 1.0 section 3.2.4 special values; EBA filing rule 2.19 forbids #nil and #empty.
        if (raw.startsWith('##')) out[code] = raw.slice(1);
        else if (raw.startsWith('#')) {
          const rule = raw === '#nil' || raw === '#empty' ? 'eba-fr.2.19' : 'xbrl-csv.special-value';
          this.findings.push({ rule, severity: 'error', message: `Line ${line}, ${code}: the special value "${printable(raw, 20)}" is not allowed here.`, template: template.code, column: code, source, line });
        } else out[code] = raw;
        continue;
      }
      const { value, conversion } = normaliseValue(column, unneutraliseFormula(raw), this.taxonomy);
      if (conversion !== 'none') this.conversions++;
      out[code] = value;
    }
    let list = this.rows.get(template.code);
    if (list === undefined) {
      list = [];
      this.rows.set(template.code, list);
    }
    list.push({ values: out, origin: { source, line } });
  }

  result(): ImportResult {
    if (this.conversions > 0) {
      this.findings.push({ rule: 'import.converted', severity: 'info', message: `${this.conversions} values were converted to taxonomy codes or plain numbers (for example "Luxembourg" to eba_GA:LU).` });
    }
    return { register: makeRegister(this.rows, this.taxonomy), findings: this.findings };
  }
}
