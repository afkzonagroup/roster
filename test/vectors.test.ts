// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The shared test vectors, also run by the Python package: the TypeScript
// validator must still produce exactly the recorded findings.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exampleRegister } from '../src/example.ts';
import { checkEuid, checkLei } from '../src/validate/identifiers.ts';
import { applyPatch, expectedFindings, type VectorCase } from './vectors-lib.ts';

const DIR = join(import.meta.dirname, '../test-vectors');
const registers = JSON.parse(readFileSync(join(DIR, 'registers.json'), 'utf8')) as { cases: VectorCase[] };
const ids = JSON.parse(readFileSync(join(DIR, 'identifiers.json'), 'utf8')) as { lei: { value: string; problem: string | null }[]; euid: { value: string; valid: boolean }[] };

describe('shared register vectors', () => {
  it('cover many cases, most with findings', () => {
    expect(registers.cases.length).toBeGreaterThan(300);
    expect(registers.cases.filter((c) => c.expected.length > 0).length).toBeGreaterThan(250);
  });
  it.each(registers.cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(expectedFindings(applyPatch(exampleRegister(), c.patch), c.options)).toEqual(c.expected);
  });
});

describe('shared identifier vectors', () => {
  it.each(ids.lei.map((x) => [x.value, x.problem] as const))('LEI %j', (v, p) => {
    expect(checkLei(v)).toBe(p);
  });
  it.each(ids.euid.map((x) => [x.value, x.valid] as const))('EUID %j', (v, ok) => {
    expect(checkEuid(v)).toBe(ok);
  });
});
