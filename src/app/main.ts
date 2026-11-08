// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Offline app: the same importers, validator and packager as the CLI, in one
// HTML file. Files are read with the File API and never leave the page.

import { ATTRIBUTION, ATTRIBUTION_URL, buildPackage, checkRegister, type CheckResult } from '../api.ts';
import { parseConfig } from '../config.ts';
import { exampleRegister, EXAMPLE_SETTINGS } from '../example.ts';
import { explain, renderExplanation } from '../explain/explain.ts';
import { importCsvFiles, type InputFile } from '../import/csv.ts';
import { importXlsx } from '../import/xlsx.ts';
import { makeRegister, rowCount, type Register } from '../model/register.ts';
import { readReportPackage } from '../package/read.ts';
import type { ReportSettings } from '../package/settings.ts';
import { DORA_4_0 } from '../taxonomy/dora.ts';
import { RosterInputError } from '../util/errors.ts';
import type { Finding } from '../validate/finding.ts';
import { streamCodec } from '../zip/codec.ts';
import { VERSION } from '../version.ts';
import { append, clear, h } from './dom.ts';

const MAX_FILE = 64 * 1024 * 1024;

interface State {
  register: Register;
  importFindings: Finding[];
  source: string;
  check: CheckResult | null;
  download: string | null;
}

const state: State = { register: makeRegister(new Map()), importFindings: [], source: '', check: null, download: null };

const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
const results = h('section', { class: 'results', 'aria-label': 'Results' });

function field(name: string, placeholder: string, value: string, extra: Record<string, string> = {}): HTMLInputElement {
  return h('input', { id: `f-${name}`, name, placeholder, value, autocomplete: 'off', spellcheck: 'false', 'aria-label': placeholder, ...extra });
}

const fLei = field('lei', 'LEI of the reporting entity (default: B_01.01)', '', { maxlength: '20' });
const fCountry = field('country', 'Country, e.g. LU (default: B_01.01)', '', { maxlength: '2' });
const fRef = field('ref', 'Reference date yyyy-mm-dd', `${new Date().getUTCFullYear() - 1}-12-31`, { maxlength: '10' });
const fCur = field('cur', 'Base currency, e.g. EUR', 'EUR', { maxlength: '3' });
const fDec = field('dec', 'Monetary decimals, e.g. -3', '-3', { maxlength: '3', inputmode: 'numeric' });
const consolidation = { value: 'IND' as 'IND' | 'CON' };
const consButtons = (['IND', 'CON'] as const).map((v) =>
  h('button', { type: 'button', class: v === consolidation.value ? 'seg on' : 'seg', 'aria-pressed': v === consolidation.value ? 'true' : 'false', 'data-v': v }, v === 'IND' ? 'Individual entity (IND)' : 'Consolidated (CON)'),
);
for (const b of consButtons) {
  b.addEventListener('click', () => {
    consolidation.value = b.dataset.v === 'CON' ? 'CON' : 'IND';
    for (const x of consButtons) {
      const on = x === b;
      x.className = on ? 'seg on' : 'seg';
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
}

function settings(): Partial<ReportSettings> {
  const dec = fDec.value.trim();
  return {
    consolidation: consolidation.value,
    referenceDate: fRef.value.trim(),
    baseCurrency: fCur.value.trim().toUpperCase(),
    decimalsMonetary: dec.toUpperCase() === 'INF' ? 'INF' : /^-?[0-9]+$/.test(dec) ? Number(dec) : Number.NaN,
    decimalsInteger: 0,
    ...(fLei.value.trim() !== '' ? { lei: fLei.value.trim().toUpperCase() } : {}),
    ...(fCountry.value.trim() !== '' ? { country: fCountry.value.trim().toUpperCase() } : {}),
  };
}

function setSettings(s: Partial<ReportSettings>): void {
  if (s.lei !== undefined) fLei.value = s.lei;
  if (s.country !== undefined) fCountry.value = s.country;
  if (s.referenceDate !== undefined) fRef.value = s.referenceDate;
  if (s.baseCurrency !== undefined) fCur.value = s.baseCurrency;
  if (s.decimalsMonetary !== undefined) fDec.value = String(s.decimalsMonetary);
  if (s.consolidation !== undefined) consButtons.find((b) => b.dataset.v === s.consolidation)?.click();
}

function say(text: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  status.textContent = text;
  status.className = `status ${kind}`;
}

function revokeDownload(): void {
  if (state.download !== null) URL.revokeObjectURL(state.download);
  state.download = null;
}

async function readFiles(list: FileList): Promise<void> {
  revokeDownload();
  const files = [...list];
  if (files.length === 0) return;
  for (const f of files) if (f.size > MAX_FILE) throw new RosterInputError('io.too-large', `${f.name} is larger than 64 MiB.`);
  const one = files[0];
  if (files.length === 1 && one !== undefined && /\.xlsx$/i.test(one.name)) {
    const r = await importXlsx(new Uint8Array(await one.arrayBuffer()), streamCodec);
    state.register = r.register;
    state.importFindings = [...r.findings];
  } else if (files.length === 1 && one !== undefined && /\.zip$/i.test(one.name)) {
    const r = await readReportPackage(new Uint8Array(await one.arrayBuffer()), one.name, streamCodec);
    state.register = r.register;
    state.importFindings = [...r.findings];
    setSettings(r.settings);
  } else {
    const csv: InputFile[] = [];
    for (const f of files) {
      if (/^roster\.json$/i.test(f.name)) setSettings(parseConfig(await f.text()));
      else if (/\.csv$/i.test(f.name)) csv.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      else throw new RosterInputError('io.unsupported', `${f.name}: choose one .xlsx workbook, one .zip report package, or CSV files (with roster.json).`);
    }
    const r = importCsvFiles(csv);
    state.register = r.register;
    state.importFindings = [...r.findings];
  }
  state.source = files.map((f) => f.name).join(', ');
  validate();
}

function validate(): void {
  state.check = checkRegister(state.register, { settings: settings() });
  render();
}

function where(f: Finding): string {
  return [f.template, f.row !== undefined ? `row ${f.row}` : undefined, f.column].filter((x) => x !== undefined).join(' ');
}

function render(): void {
  clear(results);
  const check = state.check;
  if (check === null) return;
  const findings = [...state.importFindings, ...check.findings];
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  say(`${state.source}: ${rowCount(state.register)} rows. ${counts.error} errors, ${counts.warning} warnings.`, counts.error > 0 ? 'error' : 'ok');
  append(
    results,
    h('div', { class: 'counts' },
      h('span', { class: 'count error' }, `${counts.error} errors`),
      h('span', { class: 'count warning' }, `${counts.warning} warnings`),
      h('span', { class: 'count' }, `${check.rulesRun.length} EBA validation rules run`),
    ),
  );
  if (findings.length > 0) {
    const body = h('tbody');
    for (const f of findings.slice(0, 2000)) {
      const btn = h('button', { type: 'button', class: 'rule', title: 'Show the source of this rule' }, f.rule);
      const row = h('tr', { class: f.severity }, h('td', {}, f.severity), h('td', {}, where(f)), h('td', {}, btn), h('td', {}, f.message));
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        const next = row.nextElementSibling;
        if (next !== null && next.classList.contains('explain')) {
          next.remove();
          btn.setAttribute('aria-expanded', 'false');
          return;
        }
        const cell = h('td', { 'data-span': '4' }, h('pre', {}, renderExplanation(explain(f.rule))));
        cell.colSpan = 4;
        row.after(h('tr', { class: 'explain' }, cell));
        btn.setAttribute('aria-expanded', 'true');
      });
      append(body, row);
    }
    append(results, h('table', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Level'), h('th', { scope: 'col' }, 'Where'), h('th', { scope: 'col' }, 'Rule'), h('th', { scope: 'col' }, 'Finding'))), body));
    if (findings.length > 2000) append(results, h('p', {}, `${findings.length - 2000} more findings are not shown. Use the command line tool for the full list.`));
  }
}

async function makePackage(): Promise<void> {
  revokeDownload();
  const r = await buildPackage(state.register, settings(), streamCodec, { now: new Date() });
  state.check = r.check;
  render();
  if (!r.ok) {
    say('No package: fix the errors first (see the list).', 'error');
    return;
  }
  state.download = URL.createObjectURL(new Blob([r.package.bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const a = h('a', { href: state.download, download: r.package.fileName, class: 'button primary' }, `Download ${r.package.fileName}`);
  append(results, h('p', { class: 'download' }, a));
  say(`Package ready: ${r.package.fileName}. It was built in this page; nothing was uploaded.`, 'ok');
}

function guard(fn: () => Promise<void> | void): () => void {
  return () => {
    Promise.resolve()
      .then(fn)
      .catch((e: unknown) => {
        say(e instanceof RosterInputError ? e.message : 'Something went wrong while reading the files.', 'error');
      });
  };
}

function app(): HTMLElement {
  const input = h('input', { type: 'file', id: 'files', multiple: true, accept: '.xlsx,.zip,.csv,.json', class: 'sr-only' });
  input.addEventListener('change', guard(async () => {
    if (input.files !== null) await readFiles(input.files);
    input.value = '';
  }));
  const pick = h('label', { for: 'files', class: 'button primary' }, 'Choose files');
  const example = h('button', { type: 'button', class: 'button' }, 'Try the example register');
  example.addEventListener('click', guard(() => {
    revokeDownload();
    state.register = exampleRegister();
    state.importFindings = [];
    state.source = 'Example register (fictional)';
    setSettings(EXAMPLE_SETTINGS);
    validate();
  }));
  const check = h('button', { type: 'button', class: 'button' }, 'Validate again');
  check.addEventListener('click', guard(validate));
  const pack = h('button', { type: 'button', class: 'button primary' }, 'Build report package');
  pack.addEventListener('click', guard(makePackage));
  if (typeof DecompressionStream === 'undefined') say('This browser cannot read ZIP or Excel files (no DecompressionStream). CSV files still work.', 'error');

  return h('main', {},
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, 'Roster'),
      h('h1', {}, 'DORA register of information'),
      h('p', { class: 'lead' }, `Check your register against Implementing Regulation (EU) 2024/2956 and the EBA DORA taxonomy ${DORA_4_0.framework.release}, then build the xBRL-CSV report package.`),
      h('p', { class: 'privacy' }, 'Your data stays on this computer. This page has no network access; files are read in the browser only.'),
    ),
    h('section', { class: 'card' },
      h('h2', {}, '1. Load the register'),
      h('p', {}, 'One Excel workbook (.xlsx, one sheet per template such as B_02.01), one report package (.zip), or the CSV files of the templates (b_01.01.csv ...), optionally with roster.json.'),
      h('div', { class: 'actions' }, input, pick, example),
    ),
    h('section', { class: 'card' },
      h('h2', {}, '2. Report settings'),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Level of the register' }, ...consButtons),
      h('div', { class: 'grid' }, fLei, fCountry, fRef, fCur, fDec),
      h('div', { class: 'actions' }, check, pack),
      status,
    ),
    results,
    h('footer', {},
      h('p', {}, h('a', { href: ATTRIBUTION_URL, rel: 'noopener noreferrer', target: '_blank' }, ATTRIBUTION), ` - version ${VERSION}. Free software under AGPL-3.0. `, h('a', { href: 'https://github.com/afkzonagroup/roster', rel: 'noopener noreferrer', target: '_blank' }, 'Source code'), '.'),
      h('p', {}, 'Roster checks the format and the rules that can be evaluated offline. It does not check LEIs against GLEIF or EUIDs against BRIS, and it does not make a register complete or correct. Not legal advice. Sources: ',
        h('a', { href: 'https://eur-lex.europa.eu/eli/reg/2022/2554/oj', rel: 'noopener noreferrer', target: '_blank' }, 'Regulation (EU) 2022/2554'), ', ',
        h('a', { href: 'https://eur-lex.europa.eu/eli/reg_impl/2024/2956/oj', rel: 'noopener noreferrer', target: '_blank' }, 'Implementing Regulation (EU) 2024/2956'), ', ',
        h('a', { href: 'https://www.eba.europa.eu/risk-and-data-analysis/reporting/reporting-frameworks/reporting-framework-40', rel: 'noopener noreferrer', target: '_blank' }, 'EBA reporting framework 4.0'), '.'),
    ),
  );
}

document.body.appendChild(app());
