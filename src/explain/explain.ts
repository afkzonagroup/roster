// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { DORA_4_0, allowedValues } from '../taxonomy/dora.ts';
import type { Column, Taxonomy, Template } from '../taxonomy/types.ts';
import { describeRule, type RuleInfo } from './catalogue.ts';
import { LINKS } from './sources.ts';

/** What `explain` found for a query. */
export type Explanation =
  | { readonly kind: 'rule'; readonly rule: RuleInfo }
  | { readonly kind: 'template'; readonly template: Template }
  | { readonly kind: 'column'; readonly template: Template; readonly column: Column }
  | { readonly kind: 'unknown'; readonly query: string };

/**
 * Looks up a rule id (`esa.807`, `v8826_m`, `its.lei`, `VR_71`), a template
 * (`B_02.02`) or a column (`B_02.02.0060` as in the ITS, or `B_02.02.c0060`).
 */
export function explain(query: string, taxonomy: Taxonomy = DORA_4_0): Explanation {
  const q = query.trim();
  const rule = describeRule(q, taxonomy) ?? describeRule(q.toLowerCase(), taxonomy);
  if (rule !== undefined) return { kind: 'rule', rule };
  const t = /^B_([0-9]{2})\.([0-9]{2})$/i.exec(q);
  if (t !== null) {
    const template = taxonomy.templates.find((x) => x.code === `B_${t[1] ?? ''}.${t[2] ?? ''}`);
    if (template !== undefined) return { kind: 'template', template };
  }
  const c = /^B_([0-9]{2})\.([0-9]{2})\.(c?)([0-9]{4})$/i.exec(q);
  if (c !== null) {
    const template = taxonomy.templates.find((x) => x.code === `B_${c[1] ?? ''}.${c[2] ?? ''}`);
    if (template !== undefined) {
      const itsCode = `${template.code}.${c[4] ?? ''}`;
      // Without "c" the number is read as the ITS column code (which differs for B_06.01).
      const column = c[3] === '' ? template.columns.find((x) => x.its?.code === itsCode) : template.columns.find((x) => x.code === `c${c[4] ?? ''}`);
      if (column !== undefined) return { kind: 'column', template, column };
    }
  }
  return { kind: 'unknown', query: q };
}

function wrap(text: string, width = 88, indent = '  '): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (word === '') continue;
      if (line.length + word.length + 1 > width - indent.length && line !== '') {
        out.push(indent + line);
        line = word;
      } else line = line === '' ? word : `${line} ${word}`;
    }
    out.push(indent + line);
  }
  return out.join('\n');
}

const COVERAGE: Record<RuleInfo['coverage'], string> = {
  checked: 'Checked by Roster',
  'not-checked': 'Not checked by Roster',
  'not-applicable': 'Not applicable to DORA',
  'by-construction': 'Met by construction',
};

/** Renders an explanation as plain text for a terminal. */
export function renderExplanation(e: Explanation, taxonomy: Taxonomy = DORA_4_0): string {
  const lines: string[] = [];
  if (e.kind === 'unknown') {
    return `No rule, template or column "${e.query}". Try a rule id from a finding (for example esa.807 or v8826_m), a template (B_02.02) or a column (B_02.02.0060).\n`;
  }
  if (e.kind === 'rule') {
    const r = e.rule;
    lines.push(`${r.id}: ${r.title}`, '', 'Source:', wrap(r.origin), '', `${COVERAGE[r.coverage]}:`, wrap(r.how));
    if (r.expression !== undefined) lines.push('', 'Official expression:', wrap(r.expression));
    if (r.severity !== undefined) lines.push('', `Official severity: ${r.severity}`);
    if (r.status !== undefined) lines.push(`Status: ${r.status}`);
    if (r.links.length > 0) lines.push('', 'Read:', ...r.links.map((l) => `  ${l.title}\n    ${l.url}`));
    return `${lines.join('\n')}\n`;
  }
  if (e.kind === 'template') {
    const t = e.template;
    lines.push(`${t.code}: ${t.itsName ?? t.label}`, `File in the report package: ${t.file}`, `Key columns: ${t.primaryKey.length === 0 ? 'none (one row only)' : t.primaryKey.join(', ')}`, '', 'Columns:');
    for (const c of t.columns) lines.push(`  ${c.code}${c.key ? ' [key]' : ''}  ${c.its?.code ?? '(taxonomy only)'}  ${c.its?.name ?? c.label}`);
    if (t.references.length > 0) {
      lines.push('', 'References (must match a row of another template):');
      for (const r of t.references) lines.push(`  ${r.columns.join(' + ')} -> ${r.target}   (${r.name})`);
    }
    lines.push('', 'Read:', `  ${LINKS.its.title}, Annex I\n    ${LINKS.its.url}`);
    return `${lines.join('\n')}\n`;
  }
  const { template: t, column: c } = e;
  lines.push(`${t.code} ${c.code}${c.its !== null ? ` (ITS ${c.its.code})` : ''}: ${c.its?.name ?? c.label}`);
  lines.push(`Taxonomy type: ${{ s: 'text', e: 'closed list', d: 'date yyyy-mm-dd', i: 'integer', m: 'monetary amount in units', t: 'always true' }[c.type]}${c.key ? ', key column (never empty)' : ''}`);
  if (c.its !== null) {
    lines.push(`ITS type: ${c.its.type}`, `ITS fill-in: ${c.its.status}`, '', 'ITS instruction:', wrap(c.its.instruction), '', 'ITS fill-in option:', wrap(c.its.fillIn));
  } else if (c.type === 't') {
    lines.push('', wrap('A technical "Link" column of the taxonomy that is not in the ITS. It always holds true; Roster fills it (ESAs DORA FAQ question 35).'));
  }
  if (t.code === 'B_06.01') lines.push('', wrap('Note: the Official Journal text numbers B_06.01 without 0050; the taxonomy numbers the columns 0050 to 0100 (ESAs DORA FAQ question 46). Roster uses the taxonomy codes.'));
  if (c.identifies !== null) lines.push('', `This column gives the type of code of ${c.identifies}.`);
  if (c.lei) lines.push('', c.euid ? 'Checked as an LEI (format and ISO 7064 MOD 97-10 check digits); the ITS also allows an EUID here.' : 'Checked as an LEI (format and ISO 7064 MOD 97-10 check digits).');
  const allowed = allowedValues(c, taxonomy);
  if (allowed.length > 0) {
    lines.push('', `Closed list (${allowed.length} codes):`);
    for (const m of allowed.slice(0, 40)) lines.push(`  ${m}  ${taxonomy.labels[m] ?? ''}`);
    if (allowed.length > 40) lines.push(`  ... ${allowed.length - 40} more (roster explain lists the first 40)`);
  }
  const refs = t.references.filter((r) => r.columns.includes(c.code));
  if (refs.length > 0) lines.push('', 'References:', ...refs.map((r) => `  ${r.columns.join(' + ')} -> ${r.target}   (${r.name})`));
  const rules = taxonomy.rules.filter((r) => r.tables.includes(t.code) && new RegExp(`\\b${c.code}\\b`).test(r.expression));
  if (rules.length > 0) lines.push('', 'Official validation rules that read this column:', ...rules.map((r) => `  ${r.code}${r.active ? '' : ' (deactivated)'}`));
  lines.push('', 'Read:', `  ${LINKS.its.title}, Annex I\n    ${LINKS.its.url}`);
  return `${lines.join('\n')}\n`;
}
