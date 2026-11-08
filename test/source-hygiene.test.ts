// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Repository-wide checks: no dangerous APIs, no network code, no hidden
// characters, licence headers, package hygiene.

import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.ts';

const ROOT = join(import.meta.dirname, '..');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if ((name.startsWith('.') && name !== '.github') || ['__pycache__', 'node_modules', 'dist', 'dist-typecheck', 'coverage', 'fixtures', 'build'].includes(name) || name.endsWith('.egg-info')) continue;
    const p = join(dir, name);
    const info = lstatSync(p);
    if (info.isDirectory()) out.push(...files(p, ext));
    else if (info.isFile() && ext.test(name)) out.push(p);
  }
  return out;
}

const SOURCES = files(join(ROOT, 'src'), /\.ts$/);
const SCRIPTS = files(join(ROOT, 'scripts'), /\.(mjs|ts)$/);
const ALL_CODE = [...SOURCES, ...files(join(ROOT, 'test'), /\.ts$/), ...files(join(ROOT, 'scripts'), /\.(mjs|ts)$/), ...files(join(ROOT, 'python'), /\.py$/)];

describe('source hygiene', () => {
  it('uses no eval, Function constructor, dynamic import, child processes or HTML sinks', () => {
    const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /\bimport\s*\(/, /child_process/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /setAttribute\(\s*['"]on/, /setAttribute\(\s*['"]style/];
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const re of forbidden) expect(re.test(text), `${relative(ROOT, file)} matches ${re}`).toBe(false);
    }
  });

  it('contains no network code in the library, CLI or app', () => {
    const network = [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /WebSocket/,
      /sendBeacon/,
      /EventSource/,
      /RTCPeerConnection/,
      /\bnew\s+(Shared)?Worker\s*\(/,
      /window\.open/,
      /\blocation\.(href|assign|replace)\b|\blocation\s*=/,
      /\brequire\s*\(/,
      /process\.binding/,
      /node:https?/,
      /node:net/,
      /node:dgram/,
      /node:tls/,
      /node:child_process/,
      /node:worker_threads/,
    ];
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const re of network) expect(re.test(text), `${relative(ROOT, file)} matches ${re}`).toBe(false);
    }
  });

  it('contains no invisible or bidirectional control characters (Trojan Source)', () => {
    for (const file of ALL_CODE) {
      const text = readFileSync(file, 'utf8');
      // eslint-disable-next-line no-control-regex -- detecting control characters is the purpose
      expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00a0\u200b-\u200f\u2028-\u202f\u2060-\u2069\ufeff]/.test(text), relative(ROOT, file)).toBe(false);
    }
  });

  it('has no raw bidirectional, zero-width or line-separator characters in any tracked text file', () => {
    // Every text file in the repository, including documentation, data and workflows.
    const text = [
      ...ALL_CODE,
      ...files(ROOT, /\.(md|json|ya?ml|csv|html|css|toml|txt)$/),
    ];
    expect(text.length).toBeGreaterThan(40);
    const forbidden = /[\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/;
    for (const file of text) expect(forbidden.test(readFileSync(file, 'utf8')), relative(ROOT, file)).toBe(false);
  });

  it('names no AI tool or vendor in any tracked file', () => {
    // The words are assembled at run time so this file does not contain them.
    const words = [[99, 108, 97, 117, 100, 101], [97, 110, 116, 104, 114, 111, 112, 105, 99]].map((w) => String.fromCharCode(...w));
    const all = [...ALL_CODE, ...files(ROOT, /\.(md|json|ya?ml|csv|html|css|toml|txt|cfg|ini)$|^(Dockerfile|\.gitignore|\.npmrc|\.editorconfig|\.dockerignore|LICENSE)$/)];
    for (const extra of ['.gitignore', '.npmrc', '.editorconfig', '.dockerignore']) all.push(join(ROOT, extra));
    for (const file of all) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8').toLowerCase();
      } catch {
        continue;
      }
      for (const w of words) expect(text.includes(w), `${relative(ROOT, file)} mentions a forbidden name`).toBe(false);
    }
  });

  it('keeps the network out of scripts except the source download script', () => {
    for (const file of SCRIPTS.filter((f) => !f.endsWith('fetch-sources.ts'))) expect(/\bfetch\s*\(/.test(readFileSync(file, 'utf8')), relative(ROOT, file)).toBe(false);
  });

  it('has a copyright and licence header in every source file', () => {
    for (const file of [...SOURCES, ...SCRIPTS]) {
      const text = readFileSync(file, 'utf8');
      expect(text, relative(ROOT, file)).toMatch(/Copyright 2026 MB AFKzona Group\n\/\/ SPDX-License-Identifier: AGPL-3\.0-only/);
    }
  });

  it('has no eslint-disable or ts-ignore without a written reason, and no any', () => {
    // This file is excluded: it necessarily spells out the patterns it looks for.
    for (const file of ALL_CODE.filter((f) => f.endsWith('.ts') && f !== import.meta.filename)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\/[/*]\s*eslint-disable[^\n]*/g)) expect(m[0], relative(ROOT, file)).toMatch(/ -- \S/);
      for (const m of text.matchAll(/\/\/\s*@ts-expect-error[^\n]*/g)) expect(m[0], relative(ROOT, file)).toMatch(/ -- \S/);
      expect(/\/\/\s*@ts-ignore/.test(text), relative(ROOT, file)).toBe(false);
      expect(/:\s*any\s*[,;)=>\]|]|\bas any\b|<any>/.test(text), relative(ROOT, file)).toBe(false);
    }
  });
});

describe('package', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;

  it('has zero runtime dependencies and no install scripts', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    const scripts = pkg.scripts as Record<string, string>;
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(scripts[hook]).toBeUndefined();
  });

  it('pins every development dependency exactly', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies as Record<string, string>)) expect(version, name).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it('declares licence, engines, exports and a files allow-list', () => {
    expect(pkg).toMatchObject({ name: '@afkzona/roster', license: 'AGPL-3.0-only', type: 'module', engines: { node: '>=22' } });
    expect(pkg.files).toContain('dist/');
    expect(pkg.exports).toHaveProperty('.');
    expect(pkg.version).toBe(VERSION);
  });
});
