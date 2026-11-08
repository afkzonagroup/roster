// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy } from '../taxonomy/types.ts';
import { allRuleIds, describeRule } from './catalogue.ts';

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The coverage table in docs/coverage.md, generated from the rule catalogue and the official data. */
export function coverageMarkdown(taxonomy: Taxonomy = DORA_4_0): string {
  const out: string[] = [
    '# Coverage of the official checks',
    '',
    'Generated from the rule catalogue and the official data (`npm run docs:coverage`). Do not edit by hand.',
    '',
    `Taxonomy: ${taxonomy.framework.releaseLabel}. Entry point: ${taxonomy.framework.entryPoint}.`,
    '',
    '## ESAs technical checks for the register of information',
    '',
    'Source: ESAs, overview of the RoI technical checks, validation rules and business checks (28 April 2025).',
    '',
    '| Check | Description | Roster | How |',
    '|---|---|---|---|',
  ];
  for (const c of taxonomy.checks) {
    const r = describeRule(`esa.${c.code}`, taxonomy);
    out.push(`| ${c.code} | ${cell(c.description)} | ${r?.coverage ?? ''} | ${cell(r?.how ?? '')} |`);
  }
  const active = taxonomy.rules.filter((r) => r.active).length;
  out.push(
    '',
    '## EBA validation rules (framework DORA)',
    '',
    `Source: EBA validation rules from framework 4.0, update of 12 October 2026. ${taxonomy.rules.length} rules, ${active} active. Roster evaluates every active rule from its DPM-XL expression. Deactivated rules run only with \`--include-inactive\`. All have the official severity "warning".`,
    '',
    '| Rule | Tables | Status | Roster |',
    '|---|---|---|---|',
  );
  for (const r of taxonomy.rules) {
    out.push(`| ${r.code} | ${r.tables.join(', ')} | ${r.active ? 'active' : 'deactivated'} | ${r.parseError === null ? (r.active ? 'checked' : 'checked with --include-inactive') : `not checked: ${cell(r.parseError)}`} |`);
  }
  out.push('', '## Business checks against external databases', '', 'Roster works offline and never contacts GLEIF or BRIS.', '', '| Check | Template | Column | Description | Roster |', '|---|---|---|---|---|');
  for (const e of taxonomy.externalChecks) {
    out.push(`| ${e.code} | ${e.table} | ${e.column} | ${cell(e.description)}${e.prerequisite !== null ? ` (when ${cell(e.prerequisite)})` : ''} | not checked; local format and check digit checks instead (its.lei, its.euid) |`);
  }
  out.push('', '## Checks Roster adds from the ITS, the EBA filing rules and the XBRL specifications', '', '| Rule | Title | Source |', '|---|---|---|');
  for (const id of allRuleIds(taxonomy)) {
    if (/^(esa\.|v[0-9]|e[0-9]|VR_)/.test(id)) continue;
    const r = describeRule(id, taxonomy);
    if (r !== undefined) out.push(`| ${id} | ${cell(r.title)} | ${cell(r.origin)} |`);
  }
  return `${out.join('\n')}\n`;
}
