// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { fail, RosterInputError } from '../util/errors.ts';
import { crc32 } from './crc32.ts';
import type { DeflateCodec } from './codec.ts';

/** Limits for reading a ZIP archive. All are hard upper bounds. */
export interface ZipLimits {
  /** Maximum number of entries (files and directories). */
  readonly maxEntries: number;
  /** Maximum uncompressed size of one entry, in bytes. */
  readonly maxEntrySize: number;
  /** Maximum total uncompressed size of all extracted entries, in bytes. */
  readonly maxTotalSize: number;
  /** Maximum ratio between uncompressed and compressed size of one entry. */
  readonly maxRatio: number;
}

/** Defaults: generous for real XLSX workbooks and report packages, far below what would exhaust memory. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = Object.freeze({
  maxEntries: 2_000,
  maxEntrySize: 128 * 1024 * 1024,
  maxTotalSize: 256 * 1024 * 1024,
  maxRatio: 1_000,
});

/** One entry of the central directory. */
export interface ZipEntryInfo {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc: number;
  readonly localOffset: number;
  readonly flags: number;
}

/** An opened archive. Entries are extracted on demand, within the limits. */
export interface ZipArchive {
  readonly entries: readonly ZipEntryInfo[];
  /** Returns the entry with this exact name, or undefined. */
  entry(name: string): ZipEntryInfo | undefined;
  /** Extracts and checks one file entry (size and CRC-32). */
  read(entry: ZipEntryInfo): Promise<Uint8Array>;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

function u16(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}
function u32(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0;
}

const LATIN = new TextDecoder('latin1');
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Checks an entry name. Rejects absolute paths, backslashes, drive letters,
 * `.` and `..` components, empty directory names, control characters and
 * overlong names, so no entry can point outside the archive (Report Package
 * 1.0 section 4, rpe:invalidDirectoryStructure; .ZIP APPNOTE 4.4.17).
 */
export function checkEntryName(name: string): void {
  if (name.length === 0 || name.length > 512) fail('zip.bad-name', 'An archive entry has an empty or overlong name.');
  // eslint-disable-next-line no-control-regex -- control characters in names are rejected
  if (/[\u0000-\u001f\u007f\\]/.test(name)) fail('zip.bad-name', 'An archive entry name contains a backslash or a control character.');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) fail('zip.bad-name', 'An archive entry has an absolute path.');
  const parts = name.split('/');
  // A trailing slash marks a directory entry; its last component is empty.
  const dirs = name.endsWith('/') ? parts.slice(0, -1) : parts;
  for (const part of dirs) {
    if (part === '' || part === '.' || part === '..') fail('zip.bad-name', 'An archive entry name has an empty, "." or ".." path component.');
  }
}

/**
 * Opens a ZIP archive held in memory. Only the central directory is parsed
 * here; nothing is decompressed until {@link ZipArchive.read} is called.
 *
 * Rejected: ZIP64 and multi-disk archives, encryption, compression methods
 * other than stored (0) and deflated (8), unsafe or duplicate names, files
 * whose name equals an implied directory, entries whose data overlap (a known
 * zip bomb construction), sizes or ratios above the limits, and any entry
 * whose inflated size or CRC-32 differs from the central directory.
 */
export function openZip(bytes: Uint8Array, codec: DeflateCodec, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
  if (bytes.length < 22) fail('zip.invalid', 'The file is not a ZIP archive.');
  // Find the end of central directory record: it is in the last 22 + 65535 bytes.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(bytes, at) === EOCD_SIG && at + 22 + u16(bytes, at + 20) === bytes.length) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) fail('zip.invalid', 'The file is not a ZIP archive (no end of central directory record).');
  if (eocd >= 20 && u32(bytes, eocd - 20) === ZIP64_LOCATOR_SIG) fail('zip.unsupported', 'ZIP64 archives are not supported.');
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) fail('zip.unsupported', 'Multi-disk ZIP archives are not supported.');
  const count = u16(bytes, eocd + 10);
  if (count !== u16(bytes, eocd + 8)) fail('zip.invalid', 'Inconsistent entry counts in the ZIP archive.');
  if (count > limits.maxEntries) fail('zip.too-many-entries', `The archive has more than ${limits.maxEntries} entries.`);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) fail('zip.unsupported', 'ZIP64 archives are not supported.');
  if (cdOffset + cdSize > eocd) fail('zip.invalid', 'The central directory lies outside the archive.');

  const entries: ZipEntryInfo[] = [];
  const names = new Set<string>();
  let p = cdOffset;
  let declaredTotal = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > cdOffset + cdSize || u32(bytes, p) !== CEN_SIG) fail('zip.invalid', 'The central directory is damaged.');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const disk = u16(bytes, p + 34);
    const localOffset = u32(bytes, p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > cdOffset + cdSize) fail('zip.invalid', 'The central directory is damaged.');
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
    let name: string;
    if (flags & 0x0800) {
      try {
        name = UTF8.decode(rawName);
      } catch {
        fail('zip.bad-name', 'An archive entry name is not valid UTF-8.');
      }
    } else {
      name = LATIN.decode(rawName);
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (disk !== 0) fail('zip.unsupported', 'Multi-disk ZIP archives are not supported.');
    if (flags & 0x0001 || flags & 0x0040) fail('zip.encrypted', 'Encrypted ZIP entries are not supported.');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail('zip.unsupported', 'ZIP64 archives are not supported.');
    checkEntryName(name);
    if (names.has(name)) fail('zip.duplicate', `The archive contains the name "${name}" twice.`);
    names.add(name);
    const isDirectory = name.endsWith('/');
    if (!isDirectory) {
      if (method !== 0 && method !== 8) fail('zip.unsupported', `Entry "${name}" uses an unsupported compression method (${method}).`);
      if (method === 0 && compressedSize !== size) fail('zip.invalid', `Stored entry "${name}" has inconsistent sizes.`);
      if (size > limits.maxEntrySize) fail('zip.bomb', `Entry "${name}" would expand to more than ${limits.maxEntrySize} bytes.`);
      if (size > 0 && compressedSize === 0) fail('zip.bomb', `Entry "${name}" has an impossible compression ratio.`);
      if (compressedSize > 0 && size / compressedSize > limits.maxRatio) fail('zip.bomb', `Entry "${name}" has a compression ratio above ${limits.maxRatio}:1.`);
      declaredTotal += size;
    }
    entries.push({ name, isDirectory, method, compressedSize, size, crc, localOffset, flags });
  }
  if (declaredTotal > limits.maxTotalSize) fail('zip.bomb', `The archive would expand to more than ${limits.maxTotalSize} bytes.`);
  // A file must not have the same name as a directory implied by another entry.
  for (const e of entries) {
    const parts = e.name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (names.has(dir)) fail('zip.bad-name', `"${dir}" is both a file and a directory in the archive.`);
    }
  }

  // Local headers: check signature and name, and that no two entries share bytes.
  const spans: [number, number, string][] = [];
  const dataStart = new Map<ZipEntryInfo, number>();
  for (const e of entries) {
    const at = e.localOffset;
    if (at + 30 > cdOffset || u32(bytes, at) !== LOC_SIG) fail('zip.invalid', `Entry "${e.name}" has no valid local header.`);
    const nameLen = u16(bytes, at + 26);
    const extraLen = u16(bytes, at + 28);
    const localName = bytes.subarray(at + 30, at + 30 + nameLen);
    const centralName = e.flags & 0x0800 ? new TextEncoder().encode(e.name) : Uint8Array.from(e.name, (c) => c.charCodeAt(0));
    if (localName.length !== centralName.length || localName.some((b, i) => b !== centralName[i])) {
      fail('zip.invalid', `Entry "${e.name}" has a different name in its local header.`);
    }
    if (u16(bytes, at + 8) !== e.method) fail('zip.invalid', `Entry "${e.name}" has a different method in its local header.`);
    const start = at + 30 + nameLen + extraLen;
    const end = start + e.compressedSize;
    if (end > cdOffset) fail('zip.invalid', `Entry "${e.name}" extends into the central directory.`);
    spans.push([at, end, e.name]);
    dataStart.set(e, start);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const cur = spans[i];
    if (prev !== undefined && cur !== undefined && cur[0] < prev[1]) fail('zip.bomb', `Entries "${prev[2]}" and "${cur[2]}" overlap.`);
  }

  let extracted = 0;
  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    entries,
    entry: (name) => byName.get(name),
    async read(e) {
      if (e.isDirectory) return new Uint8Array(0);
      const start = dataStart.get(e);
      if (start === undefined) fail('zip.invalid', 'Unknown archive entry.');
      if (extracted + e.size > limits.maxTotalSize) fail('zip.bomb', `Extracting the archive would pass ${limits.maxTotalSize} bytes.`);
      const raw = bytes.subarray(start, start + e.compressedSize);
      let data: Uint8Array;
      if (e.method === 0) {
        data = raw.slice();
      } else {
        try {
          data = await codec.inflateRaw(raw, e.size);
        } catch (err) {
          if (err instanceof RosterInputError) throw err;
          fail('zip.bomb', `Entry "${e.name}" cannot be inflated within its declared size (damaged data or a zip bomb).`);
        }
      }
      if (data.length !== e.size) fail('zip.invalid', `Entry "${e.name}" does not inflate to its declared size.`);
      if (crc32(data) !== e.crc) fail('zip.invalid', `Entry "${e.name}" fails its CRC-32 check.`);
      extracted += data.length;
      return data;
    },
  };
}
