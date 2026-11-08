// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { checkEntryName } from './read.ts';
import { crc32 } from './crc32.ts';
import type { DeflateCodec } from './codec.ts';
import { fail } from '../util/errors.ts';

/** A file or directory to put in an archive. Directory names end with `/`. */
export interface ZipInput {
  readonly name: string;
  readonly data?: Uint8Array;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107);
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

class Out {
  private parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }
  header(size: number, fill: (v: DataView) => void): void {
    const b = new Uint8Array(size);
    fill(new DataView(b.buffer));
    this.push(b);
  }
  join(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/**
 * Writes a ZIP archive (APPNOTE 6.3, no ZIP64, no encryption). File names
 * are checked like on reading and stored as UTF-8 (general purpose flag bit
 * 11). Each file is deflated when the codec can, otherwise stored. All entries
 * get the given modification time, so equal input gives an equal archive.
 */
export async function writeZip(inputs: readonly ZipInput[], codec: DeflateCodec, modified: Date): Promise<Uint8Array> {
  const out = new Out();
  const central = new Out();
  const { time, day } = dosDateTime(modified);
  const enc = new TextEncoder();
  const seen = new Set<string>();
  for (const input of inputs) {
    checkEntryName(input.name);
    if (seen.has(input.name)) fail('zip.duplicate', `Duplicate archive entry "${input.name}".`);
    seen.add(input.name);
    const isDir = input.name.endsWith('/');
    const data = isDir ? new Uint8Array(0) : (input.data ?? new Uint8Array(0));
    const crc = crc32(data);
    const deflated = isDir || data.length === 0 ? null : await codec.deflateRaw(data);
    const useDeflate = deflated !== null && deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const name = enc.encode(input.name);
    if (out.length + 30 + name.length + body.length > 0xfffffffe) fail('zip.too-large', 'The archive would need ZIP64.');
    const offset = out.length;
    const flags = 0x0800;
    out.header(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, flags, true);
      v.setUint16(8, method, true);
      v.setUint16(10, time, true);
      v.setUint16(12, day, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, body.length, true);
      v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true);
      v.setUint16(28, 0, true);
    });
    out.push(name);
    out.push(body);
    central.header(46, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 0x0314, true); // made by: version 2.0, UNIX
      v.setUint16(6, 20, true);
      v.setUint16(8, flags, true);
      v.setUint16(10, method, true);
      v.setUint16(12, time, true);
      v.setUint16(14, day, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, body.length, true);
      v.setUint32(24, data.length, true);
      v.setUint16(28, name.length, true);
      v.setUint16(30, 0, true);
      v.setUint16(32, 0, true);
      v.setUint16(34, 0, true);
      v.setUint16(36, 0, true);
      // External attributes: rw-r--r-- files, rwxr-xr-x directories.
      v.setUint32(38, ((isDir ? 0o40755 : 0o100644) << 16) >>> 0, true);
      v.setUint32(42, offset, true);
    });
    central.push(name);
  }
  if (inputs.length > 0xfffe) fail('zip.too-large', 'Too many archive entries.');
  const cdOffset = out.length;
  const cd = central.join();
  out.push(cd);
  out.header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, inputs.length, true);
    v.setUint16(10, inputs.length, true);
    v.setUint32(12, cd.length, true);
    v.setUint32(16, cdOffset, true);
  });
  return out.join();
}
