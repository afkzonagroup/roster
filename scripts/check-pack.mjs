// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Checks the output of `npm pack --dry-run --json` (file given as argument):
// the tarball must contain the compiled entry points. .npmrc sets
// ignore-scripts=true, so "prepack" never builds by itself.

import { readFileSync } from 'node:fs';
import process from 'node:process';

const REQUIRED = ['dist/index.js', 'dist/index.d.ts', 'dist/cli/main.js', 'dist/app/roster.html', 'LICENSE', 'LICENSE-ADDITIONAL-TERMS.md'];
const [info] = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8'));
const files = new Set((info?.files ?? []).map((f) => f.path));
const missing = REQUIRED.filter((p) => !files.has(p));
if (missing.length > 0) {
  process.stderr.write(`The package would miss: ${missing.join(', ')}. Run npm run build first.\n`);
  process.exitCode = 1;
} else process.stdout.write(`Package contents OK (${files.size} files).\n`);
