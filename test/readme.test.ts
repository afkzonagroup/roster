// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Runs the TypeScript examples in README.md, so the documentation stays true.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const TMP = join(import.meta.dirname, '.readme-tmp');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

function examples(language: string): [string, string][] {
  const out: [string, string][] = [];
  const re = new RegExp(`<!-- example:([a-z-]+) -->\\n\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'g');
  for (const m of README.matchAll(re)) out.push([m[1] ?? '', m[2] ?? '']);
  return out;
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('README examples', () => {
  const ts = examples('ts');

  it('has the expected examples', () => {
    expect(ts.map(([name]) => name)).toEqual(['library']);
    expect(examples('python').map(([name]) => name)).toEqual(['python']);
  });

  it.each(ts)('runs the %s example', async (name, code) => {
    mkdirSync(TMP, { recursive: true });
    const file = join(TMP, `${name}.ts`);
    writeFileSync(file, code.replace(/'@afkzona\/roster'/g, `'${pathToFileURL(join(ROOT, 'src/index.ts')).href}'`));
    // eslint-disable-next-line no-restricted-syntax -- loads the README example written above, not user input
    await expect(import(pathToFileURL(file).href)).resolves.toBeDefined();
  });
});
