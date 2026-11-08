// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { ATTRIBUTION, ATTRIBUTION_URL, buildPackage, checkRegister, type CheckResult } from '../api.ts';
import { CONFIG_FILE, parseConfig, type RosterConfig } from '../config.ts';
import { writeSafeCsv } from '../csv/write.ts';
import { exampleRegister, EXAMPLE_SETTINGS } from '../example.ts';
import { allRuleIds, describeRule } from '../explain/catalogue.ts';
import { explain, renderExplanation } from '../explain/explain.ts';
import { importCsvFiles, type InputFile } from '../import/csv.ts';
import { importXlsx } from '../import/xlsx.ts';
import { registerToCsvFiles } from '../import/working.ts';
import { makeRegister, rowCount, type Register } from '../model/register.ts';
import { readReportPackage } from '../package/read.ts';
import { columnOrder } from '../package/write.ts';
import { DORA_4_0 } from '../taxonomy/dora.ts';
import { RosterInputError } from '../util/errors.ts';
import { encodeUtf8, printable } from '../util/text.ts';
import type { Finding, Severity } from '../validate/finding.ts';
import { writeXlsx } from '../xlsx/write.ts';
import { nodeCodec } from '../zip/node-codec.ts';
import { VERSION } from '../version.ts';
import type { CliIo } from './io.ts';

const MAX_WORKBOOK = 64 * 1024 * 1024;
const MAX_PACKAGE = 256 * 1024 * 1024;
const MAX_CSV = 64 * 1024 * 1024;
const MAX_CSV_FILES = 64;

const FOOTER = `${ATTRIBUTION} - ${ATTRIBUTION_URL}`;

const HELP = `Roster ${VERSION} - DORA register of information: build, validate, package.

Usage:
  roster init <folder> [--example] [--xlsx] [--force]
      Create a register folder: roster.json and one CSV file per template
      (or one workbook with --xlsx). --example fills in a fictional register.
  roster import <input> --out <folder> [--force] [--reject-formulas]
      Read a workbook (.xlsx), a folder of CSV files or a report package (.zip)
      and write one working CSV file per template into <folder>.
  roster validate <input> [options]
      Check a register (folder, .xlsx) or a report package (.zip).
  roster package <input> [--out-dir <folder>] [options]
      Check the register and write the xBRL-CSV report package (.zip).
  roster explain <rule | template | column> | --list
      Show the rule and legal source behind a finding, e.g. esa.807, v8826_m,
      its.lei, B_02.02 or B_02.02.0060.

Options:
  --config <file>          Report settings (default: <folder>/roster.json).
  --reference-date <date>  Override the reference date (yyyy-mm-dd).
  --no-reporting           Validate the data only, without report settings.
  --include-inactive       Also run EBA validation rules that are deactivated.
  --format <text|json|csv> Output of validate (default text).
  --fail-on <error|warning|never>  Exit code 1 threshold (default error).
  --max-findings <n>       Stop after n findings (default 10000).
  --reject-formulas        Refuse workbook cells that contain formulas.
  --force                  Overwrite files; with package, write despite errors.
  --github-output          Write errors= and warnings= to $GITHUB_OUTPUT.
  --help, --version

Exit codes: 0 no findings at the --fail-on level, 1 findings, 2 usage or input error.
Roster works offline. Nothing is uploaded. This is not legal advice.

${FOOTER}
`;

interface Args {
  readonly command: string;
  readonly positional: string[];
  readonly flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(['--config', '--reference-date', '--format', '--fail-on', '--max-findings', '--out', '--out-dir', '--now']);
const BOOL_FLAGS = new Set(['--example', '--xlsx', '--force', '--reject-formulas', '--no-reporting', '--include-inactive', '--github-output', '--list', '--help', '--version']);

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  let options = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (options && a === '--') {
      // Everything after "--" is a file name, even if it starts with "--".
      options = false;
    } else if (options && a.startsWith('--')) {
      const [name = '', inline] = a.split(/=(.*)/s, 2);
      if (VALUE_FLAGS.has(name)) {
        const v = inline ?? argv[++i];
        if (v === undefined) throw new UsageError(`${name} needs a value.`);
        flags.set(name, v);
      } else if (BOOL_FLAGS.has(name) && inline === undefined) flags.set(name, true);
      else throw new UsageError(`Unknown option ${printable(a, 40)}.`);
    } else positional.push(a);
  }
  return { command: positional.shift() ?? '', positional, flags };
}

function str(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

/** Loaded input: register, settings, findings from reading. */
interface Loaded {
  readonly register: Register;
  readonly settings: RosterConfig | undefined;
  readonly findings: readonly Finding[];
  readonly kind: 'folder' | 'workbook' | 'package';
}

async function load(io: CliIo, input: string, args: Args): Promise<Loaded> {
  const kind = io.kind(input);
  if (kind === null) throw new UsageError(`${printable(input)} does not exist (or is a symbolic link).`);
  let settings: RosterConfig | undefined;
  const configPath = str(args, '--config');
  if (configPath !== undefined) settings = parseConfig(new TextDecoder().decode(io.readFile(configPath, 64 * 1024)), configPath);
  if (kind === 'dir') {
    const names = io.listFiles(input);
    if (configPath === undefined && names.includes(CONFIG_FILE)) settings = parseConfig(new TextDecoder().decode(io.readFile(io.join(input, CONFIG_FILE), 64 * 1024)));
    const csvNames = names.filter((n) => /\.csv$/i.test(n));
    if (csvNames.length > MAX_CSV_FILES) throw new UsageError(`More than ${MAX_CSV_FILES} CSV files in ${printable(input)}.`);
    const files: InputFile[] = csvNames.map((n) => ({ name: n, bytes: io.readFile(io.join(input, n), MAX_CSV) }));
    const r = importCsvFiles(files);
    return { register: r.register, settings, findings: r.findings, kind: 'folder' };
  }
  if (/\.xlsx$/i.test(input)) {
    const r = await importXlsx(io.readFile(input, MAX_WORKBOOK), nodeCodec, { rejectFormulas: args.flags.has('--reject-formulas') });
    return { register: r.register, settings, findings: r.findings, kind: 'workbook' };
  }
  if (/\.zip$/i.test(input)) {
    const r = await readReportPackage(io.readFile(input, MAX_PACKAGE), input, nodeCodec, { now: now(io, args) });
    return { register: r.register, settings: { ...r.settings, ...settings }, findings: r.findings, kind: 'package' };
  }
  if (/\.csv$/i.test(input)) {
    const r = importCsvFiles([{ name: input, bytes: io.readFile(input, MAX_CSV) }]);
    return { register: r.register, settings, findings: r.findings, kind: 'folder' };
  }
  if (/\.(xlsm|xlsb|xls|ods)$/i.test(input)) throw new UsageError('Only .xlsx workbooks are read. Save the workbook as .xlsx (macros are never run).');
  throw new UsageError(`Do not know how to read ${printable(input)}: give a folder of CSV files, an .xlsx workbook or a .zip report package.`);
}

function now(io: CliIo, args: Args): Date {
  const n = str(args, '--now');
  if (n === undefined) return io.now();
  const d = new Date(n);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9:.]+Z)?$/.test(n) || Number.isNaN(d.getTime())) throw new UsageError('--now must be an ISO date or UTC time.');
  return d;
}

function effectiveSettings(loaded: Loaded, args: Args): RosterConfig | undefined {
  if (args.flags.has('--no-reporting')) return undefined;
  const ref = str(args, '--reference-date');
  if (loaded.settings === undefined && ref === undefined) return undefined;
  return { ...(loaded.settings ?? {}), ...(ref !== undefined ? { referenceDate: ref } : {}) };
}

function maxFindings(args: Args): number {
  const v = str(args, '--max-findings');
  if (v === undefined) return 10_000;
  if (!/^[0-9]{1,7}$/.test(v) || Number(v) < 1) throw new UsageError('--max-findings must be a whole number from 1 to 9999999.');
  return Number(v);
}

function where(f: Finding): string {
  const parts: string[] = [];
  if (f.template !== undefined) parts.push(f.template);
  if (f.row !== undefined) parts.push(`row ${f.row}`);
  if (f.column !== undefined) parts.push(f.column);
  if (f.source !== undefined) parts.push(`${printable(f.source, 60)}${f.line !== undefined ? `:${f.line}` : ''}`);
  return parts.join(' ');
}

function renderText(findings: readonly Finding[], check: CheckResult | undefined, input: string): string {
  const out: string[] = [`Roster ${VERSION} - ${printable(input)}`, `Taxonomy: ${DORA_4_0.framework.releaseLabel}`, ''];
  const order: Severity[] = ['error', 'warning', 'info'];
  for (const sev of order) {
    const list = findings.filter((f) => f.severity === sev);
    if (list.length === 0) continue;
    out.push(`${sev.toUpperCase()}S (${list.length})`);
    for (const f of list) out.push(`  [${f.rule}] ${where(f)}`, `    ${printable(f.message, 400)}`);
    out.push('');
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  out.push(`Summary: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} notes.`);
  if (check !== undefined) {
    out.push(`Official EBA validation rules run: ${check.rulesRun.length}. Not run: ${check.notEvaluated.length} (deactivated by the EBA, or needing GLEIF/BRIS).`);
    if (check.truncated > 0) out.push(`${check.truncated} more findings were not listed (--max-findings).`);
  }
  out.push('Run "roster explain <rule>" for the source of a rule. Not legal advice.', '', FOOTER, '');
  return out.join('\n');
}

function renderJson(findings: readonly Finding[], check: CheckResult | undefined, input: string, settings: RosterConfig | undefined): string {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return `${JSON.stringify(
    {
      generator: { name: ATTRIBUTION, url: ATTRIBUTION_URL, version: VERSION },
      input,
      taxonomy: { release: DORA_4_0.framework.releaseLabel, entryPoint: DORA_4_0.framework.entryPoint },
      settings: settings ?? null,
      counts,
      findings,
      truncated: check?.truncated ?? 0,
      rulesRun: check?.rulesRun ?? [],
      notEvaluated: check?.notEvaluated ?? [],
    },
    null,
    2,
  )}\n`;
}

function renderCsv(findings: readonly Finding[]): string {
  const rows = findings.map((f) => [f.severity, f.rule, f.template ?? '', f.column ?? '', f.row === undefined ? '' : String(f.row), f.source ?? '', f.line === undefined ? '' : String(f.line), f.message, f.value ?? '']);
  rows.push(['info', 'generator', '', '', '', '', '', `${FOOTER} ${VERSION}`, '']);
  return writeSafeCsv([['severity', 'rule', 'template', 'column', 'row', 'source', 'line', 'message', 'value'], ...rows]);
}

function exitFor(findings: readonly Finding[], failOn: string): number {
  if (failOn === 'never') return 0;
  return findings.some((f) => f.severity === 'error' || (failOn === 'warning' && f.severity === 'warning')) ? 1 : 0;
}

/** Writes errors= and warnings= from the in-memory result; only plain counts reach $GITHUB_OUTPUT. */
function githubOutput(io: CliIo, findings: readonly Finding[]): void {
  const path = io.env('GITHUB_OUTPUT');
  if (path === undefined || path === '') throw new UsageError('--github-output needs the GITHUB_OUTPUT environment variable.');
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  if (!Number.isSafeInteger(errors) || !Number.isSafeInteger(warnings)) throw new Error('invalid counts');
  io.appendLine(path, `errors=${errors}`);
  io.appendLine(path, `warnings=${warnings}`);
}

async function cmdValidate(io: CliIo, args: Args): Promise<number> {
  const input = args.positional[0];
  if (input === undefined) throw new UsageError('validate needs an input.');
  const format = str(args, '--format') ?? 'text';
  if (!['text', 'json', 'csv'].includes(format)) throw new UsageError('--format must be text, json or csv.');
  const failOn = str(args, '--fail-on') ?? 'error';
  if (!['error', 'warning', 'never'].includes(failOn)) throw new UsageError('--fail-on must be error, warning or never.');
  const loaded = await load(io, input, args);
  const settings = effectiveSettings(loaded, args);
  const check = checkRegister(loaded.register, {
    ...(settings !== undefined ? { settings } : {}),
    includeInactiveRules: args.flags.has('--include-inactive'),
    maxFindings: maxFindings(args),
    now: now(io, args),
  });
  const findings = [...loaded.findings, ...check.findings];
  const text = format === 'json' ? renderJson(findings, check, input, check.settings ?? settings) : format === 'csv' ? renderCsv(findings) : renderText(findings, check, input);
  io.stdout(text);
  if (args.flags.has('--github-output')) githubOutput(io, findings);
  return exitFor(findings, failOn);
}

async function cmdPackage(io: CliIo, args: Args): Promise<number> {
  const input = args.positional[0];
  if (input === undefined) throw new UsageError('package needs an input.');
  const loaded = await load(io, input, args);
  const settings = effectiveSettings(loaded, args) ?? {};
  const t = now(io, args);
  const blocking = loaded.findings.filter((f) => f.severity === 'error');
  const result = await buildPackage(loaded.register, settings, nodeCodec, { now: t, created: t, force: args.flags.has('--force'), includeInactiveRules: args.flags.has('--include-inactive') });
  const findings = [...loaded.findings, ...result.check.findings];
  if (!result.ok || (blocking.length > 0 && !args.flags.has('--force'))) {
    io.stderr(renderText(findings.filter((f) => f.severity === 'error'), result.check, input));
    io.stderr('No package was written. Fix the errors (or use --force to write a package that the ESAs will flag or reject).\n');
    return 1;
  }
  const outDir = str(args, '--out-dir') ?? '.';
  if (io.kind(outDir) === null) io.makeDir(outDir);
  if (io.kind(outDir) !== 'dir') throw new UsageError(`${printable(outDir)} is not a folder.`);
  const path = io.join(outDir, result.package.fileName);
  io.writeFile(path, result.package.bytes, args.flags.has('--force'));
  if (args.flags.has('--github-output')) {
    githubOutput(io, findings);
    // Only a plain path from this run: printable ASCII, no line breaks.
    if (/^[A-Za-z0-9._/ -]{1,1024}$/.test(path)) {
      const out = io.env('GITHUB_OUTPUT');
      if (out !== undefined) io.appendLine(out, `package=${path}`);
    }
  }
  const counts = result.check.counts;
  io.stdout(`Wrote ${printable(path)}\n${rowCount(loaded.register)} rows, ${counts.error} errors, ${counts.warning} warnings. Run "roster validate ${printable(path)}" to check the package.\n${FOOTER}\n`);
  return 0;
}

async function cmdInit(io: CliIo, args: Args): Promise<number> {
  const dir = args.positional[0];
  if (dir === undefined) throw new UsageError('init needs a folder.');
  const force = args.flags.has('--force');
  const k = io.kind(dir);
  if (k === 'file') throw new UsageError(`${printable(dir)} is a file.`);
  if (k === 'dir' && io.listFiles(dir).length > 0 && !force) throw new UsageError(`${printable(dir)} is not empty. Use --force to write into it.`);
  io.makeDir(dir);
  const example = args.flags.has('--example');
  const register = example ? exampleRegister() : makeRegister(new Map());
  const year = io.now().getUTCFullYear();
  const config: RosterConfig = example ? EXAMPLE_SETTINGS : { consolidation: 'IND', referenceDate: `${year - 1}-12-31`, baseCurrency: 'EUR', decimalsMonetary: -3, decimalsInteger: 0 };
  io.writeFile(io.join(dir, CONFIG_FILE), encodeUtf8(`${JSON.stringify(config, null, 2)}\n`), force);
  if (args.flags.has('--xlsx')) {
    const sheets = DORA_4_0.templates.map((t) => {
      const order = columnOrder(t).filter((c) => t.columns.find((x) => x.code === c)?.type !== 't');
      const names = order.map((c) => t.columns.find((x) => x.code === c)?.its?.name ?? c);
      const rows = (register.tables.get(t.code)?.rows ?? []).map((r) => order.map((c) => r.values[c] ?? ''));
      return { name: t.code, rows: [order, names, ...rows] };
    });
    io.writeFile(io.join(dir, 'register.xlsx'), await writeXlsx(sheets, nodeCodec, io.now()), force);
  } else {
    for (const f of registerToCsvFiles(register)) io.writeFile(io.join(dir, f.name), f.bytes, force);
  }
  io.stdout(
    `Created ${printable(dir)} with ${CONFIG_FILE} and ${args.flags.has('--xlsx') ? 'register.xlsx' : 'one CSV file per template'}${example ? ' (fictional example data)' : ''}.\nNext: fill in the templates, then run "roster validate ${printable(dir)}${args.flags.has('--xlsx') ? `/register.xlsx --config ${printable(dir)}/${CONFIG_FILE}` : ''}".\n${FOOTER}\n`,
  );
  return 0;
}

async function cmdImport(io: CliIo, args: Args): Promise<number> {
  const input = args.positional[0];
  const out = str(args, '--out');
  if (input === undefined || out === undefined) throw new UsageError('import needs an input and --out <folder>.');
  const loaded = await load(io, input, args);
  const force = args.flags.has('--force');
  if (io.kind(out) === null) io.makeDir(out);
  if (io.kind(out) !== 'dir') throw new UsageError(`${printable(out)} is not a folder.`);
  const outputs = registerToCsvFiles(loaded.register);
  // Check before writing anything, so a refused import leaves no half-written folder.
  if (!force) for (const name of [...outputs.map((f) => f.name), CONFIG_FILE]) if (io.kind(io.join(out, name)) !== null) throw new UsageError(`${printable(io.join(out, name))} exists. Use --force to overwrite it.`);
  for (const f of outputs) io.writeFile(io.join(out, f.name), f.bytes, force);
  if (loaded.kind === 'package' && loaded.settings !== undefined) io.writeFile(io.join(out, CONFIG_FILE), encodeUtf8(`${JSON.stringify(loaded.settings, null, 2)}\n`), force);
  io.stdout(renderText(loaded.findings, undefined, input));
  io.stdout(`Wrote ${DORA_4_0.templates.length} CSV files with ${rowCount(loaded.register)} rows to ${printable(out)}.\n`);
  return loaded.findings.some((f) => f.severity === 'error') ? 1 : 0;
}

function cmdExplain(io: CliIo, args: Args): number {
  if (args.flags.has('--list')) {
    const lines = allRuleIds().map((id) => {
      const r = describeRule(id);
      return `${id.padEnd(34)} ${(r?.coverage ?? '').padEnd(15)} ${printable(r?.title ?? '', 70)}`;
    });
    io.stdout(`${'Rule'.padEnd(34)} ${'Coverage'.padEnd(15)} Title\n${lines.join('\n')}\n\n${FOOTER}\n`);
    return 0;
  }
  const q = args.positional[0];
  if (q === undefined) throw new UsageError('explain needs a rule, template or column (or --list).');
  const e = explain(q);
  io.stdout(`${renderExplanation(e)}\n${FOOTER}\n`);
  return e.kind === 'unknown' ? 2 : 0;
}

/** Runs the command line tool and returns the exit code. Never throws. */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.flags.has('--version')) {
      io.stdout(`roster ${VERSION}\n${FOOTER}\n`);
      return 0;
    }
    if (args.flags.has('--help') || args.command === '' || args.command === 'help') {
      io.stdout(HELP);
      return args.command === '' && !args.flags.has('--help') ? 2 : 0;
    }
    switch (args.command) {
      case 'validate':
        return await cmdValidate(io, args);
      case 'package':
        return await cmdPackage(io, args);
      case 'init':
        return await cmdInit(io, args);
      case 'import':
        return await cmdImport(io, args);
      case 'explain':
        return cmdExplain(io, args);
      default:
        throw new UsageError(`Unknown command ${printable(args.command, 30)}. Run roster --help.`);
    }
  } catch (e) {
    if (e instanceof UsageError || e instanceof RosterInputError) {
      io.stderr(`roster: ${e.message}\n`);
      return 2;
    }
    // Unexpected failure: no stack trace, no data.
    io.stderr('roster: internal error. Please report it (without your data) at https://github.com/afkzonagroup/roster/issues\n');
    return 2;
  }
}
