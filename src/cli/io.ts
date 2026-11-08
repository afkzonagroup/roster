// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** The side effects the command line tool needs. Tests can provide their own. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Reads a regular file of at most `maxBytes` bytes. */
  readFile(path: string, maxBytes: number): Uint8Array;
  /** Regular files (not links, not folders) directly inside a folder, by name. */
  listFiles(dir: string): string[];
  /** 'file', 'dir', or null when the path does not exist or is something else. */
  kind(path: string): 'file' | 'dir' | null;
  /** Creates a folder (and parents) with mode 0700. */
  makeDir(path: string): void;
  /** Writes a new file with mode 0600; refuses to overwrite unless `overwrite`; never follows links. */
  writeFile(path: string, data: Uint8Array, overwrite: boolean): void;
  /** Appends a line to a file (GitHub Actions output); never follows links. */
  appendLine(path: string, line: string): void;
  join(...parts: string[]): string;
  env(name: string): string | undefined;
  now(): Date;
}
