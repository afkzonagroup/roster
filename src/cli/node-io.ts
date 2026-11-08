// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fail } from '../util/errors.ts';
import type { CliIo } from './io.ts';

/** File system and console access for the command line tool. */
export const nodeIo: CliIo = {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  readFile(path, maxBytes) {
    // O_NOFOLLOW: a symbolic link as the last path component is refused.
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return fail('io.read', `Cannot open ${path} (missing, a symbolic link, or not readable).`);
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) fail('io.read', `${path} is not a regular file.`);
      if (st.size > maxBytes) fail('io.too-large', `${path} is larger than ${maxBytes} bytes.`);
      const buf = new Uint8Array(st.size);
      let at = 0;
      while (at < buf.length) {
        const n = readSync(fd, buf, at, buf.length - at, at);
        if (n === 0) break;
        at += n;
      }
      return buf.subarray(0, at);
    } finally {
      closeSync(fd);
    }
  },
  listFiles(dir) {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  },
  kind(path) {
    try {
      const st = lstatSync(path);
      return st.isFile() ? 'file' : st.isDirectory() ? 'dir' : null;
    } catch {
      return null;
    }
  },
  makeDir(path) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  },
  writeFile(path, data, overwrite) {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (overwrite ? constants.O_TRUNC : constants.O_EXCL);
    let fd: number;
    try {
      fd = openSync(path, flags, 0o600);
    } catch (e) {
      const code = (e as { code?: string }).code;
      return fail('io.write', code === 'EEXIST' ? `${path} exists. Use --force to overwrite it.` : `Cannot write ${path} (${code ?? 'error'}).`);
    }
    try {
      let at = 0;
      while (at < data.length) at += writeSync(fd, data, at, data.length - at);
    } finally {
      closeSync(fd);
    }
  },
  appendLine(path, line) {
    const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      writeSync(fd, `${line}\n`);
    } finally {
      closeSync(fd);
    }
  },
  join,
  env: (name) => process.env[name],
  now: () => new Date(),
};
