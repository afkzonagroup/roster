// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exampleRegister } from '../src/example.ts';
import { coverageMarkdown } from '../src/explain/coverage.ts';
import { importCsvFiles } from '../src/import/csv.ts';

const ROOT = join(import.meta.dirname, '..');
const ACTION = readFileSync(join(ROOT, 'action.yml'), 'utf8');
const TMP = join(import.meta.dirname, '.tmp', 'action');

/** The run: block of the step with this id. */
function stepScript(id: string): string {
  const start = ACTION.indexOf(`id: ${id}`);
  const run = ACTION.indexOf('run: |', start);
  const lines = ACTION.slice(run + 'run: |'.length + 1).split('\n');
  const body: string[] = [];
  for (const l of lines) {
    if (l.trim() !== '' && !l.startsWith('        ')) break;
    body.push(l.slice(8));
  }
  return body.join('\n');
}

describe('GitHub Action', () => {
  it('passes inputs only through environment variables and pins actions by SHA', () => {
    for (const block of ACTION.split('run: |').slice(1)) {
      const script = block.split(/\n {4}- /)[0] ?? '';
      expect(script).not.toMatch(/\$\{\{/);
    }
    for (const m of ACTION.matchAll(/uses: ([^\s]+)/g)) expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
  });

  it('runs the validate and package steps and writes only plain outputs', () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    // Run the real step scripts with the CLI from the sources (Node strips the types).
    const shim = join(TMP, 'dist/cli');
    mkdirSync(shim, { recursive: true });
    writeFileSync(join(shim, 'main.js'), `import '${join(ROOT, 'src/cli/main.ts')}';\n`);
    const out = join(TMP, 'out.txt');
    const env = { ...process.env, GITHUB_ACTION_PATH: TMP, GITHUB_OUTPUT: out, ROSTER_INPUT: join(ROOT, 'examples/register'), ROSTER_CONFIG: '', ROSTER_REFERENCE_DATE: '', ROSTER_FAIL_ON: 'error', ROSTER_INACTIVE: 'false', ROSTER_PACKAGE_DIR: join(TMP, 'pkg') };
    execFileSync('bash', ['-c', stepScript('check')], { env, stdio: 'pipe' });
    execFileSync('bash', ['-c', stepScript('pack')], { env, stdio: 'pipe' });
    const lines = readFileSync(out, 'utf8').trim().split('\n');
    expect(lines.slice(0, 2)).toEqual(['errors=0', 'warnings=0']);
    expect(lines[2]).toMatch(/^package=.+\/pkg\/EXAMPLE0PAYMENTS0158\.IND_LU_DORA010100_DORA_2025-12-31_[0-9]{17}\.zip$/);
    expect(lines).toHaveLength(3);
    // A newline in package-dir is refused before anything runs.
    expect(() => execFileSync('bash', ['-c', stepScript('pack')], { env: { ...env, ROSTER_PACKAGE_DIR: 'a\nb' }, stdio: 'pipe' })).toThrow();
    rmSync(TMP, { recursive: true, force: true });
  });
});

describe('Dockerfile', () => {
  const docker = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  it('pins the base image by digest and runs as a non-root user without npm', () => {
    for (const m of docker.matchAll(/^FROM (\S+)/gm)) expect(m[1]).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(docker).toMatch(/^USER roster$/m);
    expect(docker).toMatch(/rm -rf \/usr\/local\/lib\/node_modules\/npm/);
  });
});

describe('generated documentation and examples', () => {
  it('docs/coverage.md is up to date', () => {
    expect(readFileSync(join(ROOT, 'docs/coverage.md'), 'utf8')).toBe(coverageMarkdown());
  });

  it('examples/register is the example register', () => {
    const dir = join(ROOT, 'examples/register');
    const files = readdirSync(dir).filter((n) => n.endsWith('.csv')).map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(join(dir, n))) }));
    const r = importCsvFiles(files);
    expect(r.findings).toEqual([]);
    for (const [code, t] of exampleRegister().tables) expect(r.register.tables.get(code)?.rows.map((x) => x.values), code).toEqual(t.rows.map((x) => x.values));
  });
});
