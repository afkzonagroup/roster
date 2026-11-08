// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CliIo } from '../src/cli/io.ts';
import { nodeIo } from '../src/cli/node-io.ts';
import { run } from '../src/cli/run.ts';

const TMP = join(import.meta.dirname, '.tmp', 'cli');

interface Captured {
  out: string;
  err: string;
  io: CliIo;
}

function capture(env: Record<string, string> = {}): Captured {
  const c: Captured = { out: '', err: '', io: nodeIo };
  c.io = {
    ...nodeIo,
    stdout: (t) => {
      c.out += t;
    },
    stderr: (t) => {
      c.err += t;
    },
    env: (n) => env[n],
    now: () => new Date('2026-01-20T10:00:00Z'),
  };
  return c;
}

const p = (...x: string[]): string => join(TMP, ...x);

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('roster CLI', () => {
  it('prints help and version with the attribution', async () => {
    const c = capture();
    expect(await run(['--help'], c.io)).toBe(0);
    expect(c.out).toMatch(/roster init <folder>/);
    expect(c.out).toMatch(/Roster by AFKzona Group - https:\/\/afkzonagroup\.lt/);
    const v = capture();
    expect(await run(['--version'], v.io)).toBe(0);
    expect(v.out).toMatch(/^roster 0\.1\.0\nRoster by AFKzona Group/);
    expect(await run([], capture().io)).toBe(2);
  });

  it('rejects unknown commands and options with exit code 2', async () => {
    const c = capture();
    expect(await run(['frobnicate'], c.io)).toBe(2);
    expect(c.err).toMatch(/Unknown command/);
    expect(await run(['validate', 'x', '--evil'], c.io)).toBe(2);
    expect(await run(['validate', 'x', '--format'], c.io)).toBe(2);
    expect(await run(['validate', p('missing')], c.io)).toBe(2);
    expect(await run(['validate', p('x.xls')], capture().io)).toBe(2);
    // After "--" an input may start with dashes and is never read as an option.
    const dash = capture();
    expect(await run(['validate', '--', '--include-inactive'], dash.io)).toBe(2);
    expect(dash.err).toMatch(/--include-inactive does not exist/);
  });

  it('init --example, validate, package, validate the package', async () => {
    const c = capture();
    expect(await run(['init', p('reg'), '--example'], c.io)).toBe(0);
    expect(readdirSync(p('reg')).sort()).toHaveLength(16);
    expect(statSync(p('reg', 'roster.json')).mode & 0o777).toBe(0o600);
    const v = capture();
    expect(await run(['validate', p('reg')], v.io)).toBe(0);
    expect(v.out).toMatch(/Summary: 0 errors, 0 warnings/);
    const k = capture();
    expect(await run(['package', p('reg'), '--out-dir', p('out')], k.io)).toBe(0);
    const zip = readdirSync(p('out'))[0] ?? '';
    expect(zip).toBe('EXAMPLE0PAYMENTS0158.IND_LU_DORA010100_DORA_2025-12-31_20260120100000000.zip');
    expect(statSync(p('out', zip)).mode & 0o777).toBe(0o600);
    const z = capture();
    expect(await run(['validate', p('out', zip), '--format', 'json'], z.io)).toBe(0);
    const json = JSON.parse(z.out) as { counts: { error: number }; generator: { name: string }; rulesRun: string[] };
    expect(json.counts.error).toBe(0);
    expect(json.generator.name).toBe('Roster by AFKzona Group');
    expect(json.rulesRun.length).toBe(49);
    // Never overwrite without --force.
    const again = capture();
    expect(await run(['package', p('reg'), '--out-dir', p('out')], again.io)).toBe(2);
    expect(again.err).toMatch(/exists\. Use --force/);
    expect(await run(['init', p('reg')], capture().io)).toBe(2);
  });

  it('package refuses a register with errors and writes nothing', async () => {
    await run(['init', p('reg'), '--example'], capture().io);
    writeFileSync(p('reg', 'b_03.01.csv'), 'c0010,c0020\nNOPE,EXAMPLE0PAYMENTS0158\n');
    const c = capture();
    expect(await run(['package', p('reg'), '--out-dir', p('out')], c.io)).toBe(1);
    expect(c.err).toMatch(/esa\.807/);
    expect(c.err).toMatch(/No package was written/);
    expect(existsSync(p('out'))).toBe(false);
    expect(await run(['package', p('reg'), '--out-dir', p('out'), '--force'], capture().io)).toBe(0);
  });

  it('validate formats, --fail-on and --github-output (plain counts only)', async () => {
    await run(['init', p('reg'), '--example'], capture().io);
    writeFileSync(p('reg', 'b_05.01.csv'), readFileSync(p('reg', 'b_05.01.csv'), 'utf8').replace('Example Cloud Services Limited,', ' Example Cloud Services Limited ,'));
    const t = capture();
    expect(await run(['validate', p('reg')], t.io)).toBe(0);
    expect(t.out).toMatch(/WARNINGS \(1\)/);
    expect(await run(['validate', p('reg'), '--fail-on', 'warning'], capture().io)).toBe(1);
    writeFileSync(p('reg', 'b_06.01.csv'), 'c0010,c0040\n=cmd|calc,EXAMPLE0PAYMENTS0158\n');
    const csv = capture();
    expect(await run(['validate', p('reg'), '--format', 'csv'], csv.io)).toBe(1);
    expect(csv.out.split('\r\n')[0]).toBe('severity,rule,template,column,row,source,line,message,value');
    expect(csv.out).toContain("'=cmd|calc");
    expect(csv.out).not.toMatch(/(^|,)=cmd/m);
    expect(csv.out).toMatch(/generator/);
    expect(await run(['validate', p('reg'), '--fail-on', 'never'], capture().io)).toBe(0);
    const gh = p('gh.txt');
    const g = capture({ GITHUB_OUTPUT: gh });
    expect(await run(['validate', p('reg'), '--github-output'], g.io)).toBe(1);
    expect(readFileSync(gh, 'utf8')).toMatch(/^errors=[0-9]+\nwarnings=[0-9]+\n$/);
    expect(await run(['validate', p('reg'), '--github-output'], capture().io)).toBe(2);
    await run(['init', p('ok'), '--example'], capture().io);
    const pk = capture({ GITHUB_OUTPUT: p('gh2.txt') });
    expect(await run(['package', p('ok'), '--out-dir', p('pk'), '--github-output'], pk.io)).toBe(0);
    expect(readFileSync(p('gh2.txt'), 'utf8')).toMatch(/^errors=0\nwarnings=0\npackage=.+\/pk\/EXAMPLE0PAYMENTS0158\.IND_LU_DORA010100_DORA_2025-12-31_20260120100000000\.zip\n$/);
    expect(await run(['validate', p('reg'), '--max-findings', '0'], capture().io)).toBe(2);
    expect(await run(['validate', p('reg'), '--format', 'xml'], capture().io)).toBe(2);
    expect(await run(['validate', p('reg'), '--fail-on', 'x'], capture().io)).toBe(2);
  });

  it('settings: --no-reporting, --reference-date, --config and --now', async () => {
    await run(['init', p('reg'), '--example'], capture().io);
    const fut = capture();
    expect(await run(['validate', p('reg'), '--reference-date', '2027-12-31'], fut.io)).toBe(1);
    expect(fut.out).toMatch(/esa\.111/);
    expect(await run(['validate', p('reg'), '--reference-date', '2027-12-31', '--no-reporting'], capture().io)).toBe(0);
    expect(await run(['validate', p('reg'), '--reference-date', '2027-12-31', '--now', '2028-01-05'], capture().io)).toBe(0);
    expect(await run(['validate', p('reg'), '--now', 'yesterday'], capture().io)).toBe(2);
    writeFileSync(p('other.json'), '{"consolidation":"CON","referenceDate":"2025-12-31","baseCurrency":"EUR"}');
    const k = capture();
    expect(await run(['package', p('reg'), '--config', p('other.json'), '--out-dir', p('o')], k.io)).toBe(0);
    expect(readdirSync(p('o'))[0]).toMatch(/\.CON_LU_/);
    writeFileSync(p('bad.json'), '{"lie":"x"}');
    const b = capture();
    expect(await run(['validate', p('reg'), '--config', p('bad.json')], b.io)).toBe(2);
    expect(b.err).toMatch(/unknown setting "lie"/);
  });

  it('init --xlsx writes a workbook that validates; import converts it to CSV', async () => {
    expect(await run(['init', p('wb'), '--example', '--xlsx'], capture().io)).toBe(0);
    expect(readdirSync(p('wb')).sort()).toEqual(['register.xlsx', 'roster.json']);
    const v = capture();
    expect(await run(['validate', p('wb', 'register.xlsx'), '--config', p('wb', 'roster.json')], v.io)).toBe(0);
    expect(v.out).toMatch(/0 errors, 0 warnings/);
    const i = capture();
    expect(await run(['import', p('wb', 'register.xlsx'), '--out', p('csv')], i.io)).toBe(0);
    expect(readdirSync(p('csv'))).toHaveLength(15);
    expect(await run(['validate', p('csv'), '--config', p('wb', 'roster.json')], capture().io)).toBe(0);
    expect(await run(['import', p('wb', 'register.xlsx')], capture().io)).toBe(2);
    // A second import into the same folder is refused before anything is written.
    writeFileSync(p('csv', 'b_01.01.csv'), 'mine');
    const again = capture();
    expect(await run(['import', p('wb', 'register.xlsx'), '--out', p('csv')], again.io)).toBe(2);
    expect(again.err).toMatch(/b_01\.01\.csv exists/);
    expect(readFileSync(p('csv', 'b_01.01.csv'), 'utf8')).toBe('mine');
  });

  it('import from a report package also writes roster.json', async () => {
    await run(['init', p('reg'), '--example'], capture().io);
    await run(['package', p('reg'), '--out-dir', p('out')], capture().io);
    const zip = readdirSync(p('out'))[0] ?? '';
    expect(await run(['import', p('out', zip), '--out', p('back')], capture().io)).toBe(0);
    expect(JSON.parse(readFileSync(p('back', 'roster.json'), 'utf8'))).toMatchObject({ consolidation: 'IND', country: 'LU', baseCurrency: 'EUR' });
    expect(await run(['validate', p('back')], capture().io)).toBe(0);
    expect(await run(['validate', p('reg', 'b_01.01.csv'), '--no-reporting'], capture().io)).toBe(0);
  });

  it('does not follow symbolic links when reading or writing', async () => {
    await run(['init', p('reg'), '--example'], capture().io);
    writeFileSync(p('secret.txt'), 'secret');
    symlinkSync(p('secret.txt'), p('link.xlsx'));
    expect(await run(['validate', p('link.xlsx')], capture().io)).toBe(2);
    // A link inside a register folder is not read.
    symlinkSync(p('secret.txt'), p('reg', 'b_99.02.csv'));
    const v = capture();
    expect(await run(['validate', p('reg')], v.io)).toBe(0);
    mkdirSync(p('out'));
    symlinkSync(p('secret.txt'), p('out', 'EXAMPLE0PAYMENTS0158.IND_LU_DORA010100_DORA_2025-12-31_20260120100000000.zip'));
    const k = capture();
    expect(await run(['package', p('reg'), '--out-dir', p('out'), '--force'], k.io)).toBe(2);
    expect(readFileSync(p('secret.txt'), 'utf8')).toBe('secret');
    // Reading through a link is refused by the file layer itself, too.
    expect(() => nodeIo.readFile(p('link.xlsx'), 1000)).toThrow(/symbolic link/);
  });

  it('writes no package path to $GITHUB_OUTPUT when the path could inject a line', async () => {
    await run(['init', p('ok'), '--example'], capture().io);
    const gh = p('gh3.txt');
    expect(await run(['package', p('ok'), '--out-dir', p('pk\ninjected=1'), '--github-output'], capture({ GITHUB_OUTPUT: gh }).io)).toBe(0);
    expect(readFileSync(gh, 'utf8')).toBe('errors=0\nwarnings=0\n');
  });

  it('limits input sizes', async () => {
    writeFileSync(p('big.xlsx'), Buffer.alloc(10));
    const c = capture();
    c.io = { ...c.io, readFile: (path, max) => nodeIo.readFile(path, Math.min(max, 5)) };
    expect(await run(['validate', p('big.xlsx')], c.io)).toBe(2);
    expect(c.err).toMatch(/larger than 5 bytes/);
  });

  it('explain shows rules and the full list; unknown queries exit 2', async () => {
    const c = capture();
    expect(await run(['explain', 'its.lei'], c.io)).toBe(0);
    expect(c.out).toMatch(/ISO 7064 MOD 97-10/);
    const l = capture();
    expect(await run(['explain', '--list'], l.io)).toBe(0);
    expect(l.out).toMatch(/VR_71 +not-checked/);
    expect(await run(['explain', 'nothing'], capture().io)).toBe(2);
    expect(await run(['explain'], capture().io)).toBe(2);
  });

  it('never prints a stack trace on an internal error', async () => {
    const c = capture();
    c.io = { ...c.io, kind: () => { throw new Error('boom /secret/path'); } };
    expect(await run(['validate', 'x'], c.io)).toBe(2);
    expect(c.err).toBe('roster: internal error. Please report it (without your data) at https://github.com/afkzonagroup/roster/issues\n');
  });

  it('sanitises control characters in names it prints', async () => {
    const c = capture();
    expect(await run(['validate', `${p('x')}\u001b[31m`], c.io)).toBe(2);
    expect(c.err).not.toContain('\u001b');
    expect(c.err).toContain('\\u{1b}');
    // Also in the report of an input that exists.
    await run(['init', p('esc\u001b[2J'), '--example'], capture().io);
    const r = capture();
    expect(await run(['validate', p('esc\u001b[2J')], r.io)).toBe(0);
    expect(r.out).not.toContain('\u001b');
    expect(r.out).toContain('esc\\u{1b}[2J');
  });

  it('reads only regular files and refuses too many CSV files in a folder', async () => {
    mkdirSync(p('dir.xlsx'));
    expect(() => nodeIo.readFile(p('dir.xlsx'), 1000)).toThrow(/not a regular file/);
    mkdirSync(p('many'));
    for (let i = 0; i < 65; i++) writeFileSync(p('many', `f${i}.csv`), 'c0010\n');
    const c = capture();
    expect(await run(['validate', p('many')], c.io)).toBe(2);
    expect(c.err).toMatch(/More than 64 CSV files/);
  });

  it('creates output folders with mode 0700 and never appends to $GITHUB_OUTPUT through a link', async () => {
    await run(['init', p('reg'), '--example'], capture().io);
    expect(await run(['package', p('reg'), '--out-dir', p('new', 'out')], capture().io)).toBe(0);
    expect(statSync(p('new', 'out')).mode & 0o777).toBe(0o700);
    writeFileSync(p('victim.txt'), 'keep');
    symlinkSync(p('victim.txt'), p('gh-link'));
    expect(await run(['validate', p('reg'), '--github-output'], capture({ GITHUB_OUTPUT: p('gh-link') }).io)).toBe(2);
    expect(readFileSync(p('victim.txt'), 'utf8')).toBe('keep');
  });
});
