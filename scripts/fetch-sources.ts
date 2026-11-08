// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Downloads the official source files listed in scripts/sources.json into
// .sources/ and checks each against its SHA-256. Maintainer tool; the
// library, CLI and app never use the network. Requires Node >= 22.18.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Source {
  id: string;
  url: string;
  file: string;
  sha256: string;
  bytes: number;
}

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, '.sources');
const manifest = JSON.parse(await readFile(join(ROOT, 'scripts/sources.json'), 'utf8')) as { sources: Source[] };
await mkdir(DIR, { recursive: true, mode: 0o700 });
let failed = false;
for (const s of manifest.sources) {
  const target = join(DIR, s.file);
  let data: Buffer | undefined;
  try {
    data = await readFile(target);
  } catch {
    data = undefined;
  }
  if (data === undefined || createHash('sha256').update(data).digest('hex') !== s.sha256) {
    process.stdout.write(`Downloading ${s.id} ...\n`);
    const res = await fetch(s.url, { headers: { 'user-agent': 'roster-sources/0.1 (+https://github.com/afkzonagroup/roster)', accept: '*/*' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`${s.id}: HTTP ${res.status}`);
    data = Buffer.from(await res.arrayBuffer());
  }
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== s.sha256 || data.length !== s.bytes) {
    process.stderr.write(`${s.id}: checksum mismatch (got ${sha}, ${data.length} bytes). The publisher may have replaced the file; review it before updating scripts/sources.json.\n`);
    failed = true;
    continue;
  }
  await writeFile(target, data, { mode: 0o600 });
  process.stdout.write(`${s.id}: OK ${sha}\n`);
}
if (failed) process.exitCode = 1;
