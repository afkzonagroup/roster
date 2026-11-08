// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/zip/crc32.ts';
import { streamCodec, type DeflateCodec } from '../src/zip/codec.ts';
import { nodeCodec } from '../src/zip/node-codec.ts';
import { checkEntryName, openZip } from '../src/zip/read.ts';
import { writeZip } from '../src/zip/write.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const T = new Date('2026-01-20T10:00:00Z');

/** Builds a raw ZIP by hand so hostile structures can be made. */
function rawZip(entries: { name: string; data: Uint8Array; method?: number; size?: number; crc?: number; flags?: number; localName?: string; offset?: number }[], extra: { zip64Locator?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    const lname = enc(e.localName ?? e.name);
    const h = new Uint8Array(30);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(8, e.method ?? 0, true);
    v.setUint16(26, lname.length, true);
    offsets.push(at);
    parts.push(h, lname, e.data);
    at += 30 + lname.length + e.data.length;
  }
  entries.forEach((e, i) => {
    const name = enc(e.name);
    const c = new Uint8Array(46);
    const v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(8, e.flags ?? 0x0800, true);
    v.setUint16(10, e.method ?? 0, true);
    v.setUint32(16, e.crc ?? crc32(e.method === 8 ? new Uint8Array(0) : e.data), true);
    v.setUint32(20, e.data.length, true);
    v.setUint32(24, e.size ?? e.data.length, true);
    v.setUint16(28, name.length, true);
    v.setUint32(42, e.offset ?? offsets[i] ?? 0, true);
    central.push(c, name);
  });
  const cdStart = at;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const out: Uint8Array[] = [...parts, ...central];
  if (extra.zip64Locator === true) {
    const loc = new Uint8Array(20);
    new DataView(loc.buffer).setUint32(0, 0x07064b50, true);
    out.push(loc);
  }
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, cdStart, true);
  out.push(end);
  const total = out.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let p = 0;
  for (const part of out) {
    buf.set(part, p);
    p += part.length;
  }
  return buf;
}

describe('CRC-32', () => {
  it('matches the standard check value', () => {
    expect(crc32(enc('123456789')).toString(16)).toBe('cbf43926');
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe.each([
  ['node:zlib', nodeCodec],
  ['Compression Streams', streamCodec],
] as [string, DeflateCodec][])('ZIP round trip with %s', (_name, codec) => {
  it('writes and reads files, directories and UTF-8 names', async () => {
    const text = 'x'.repeat(5000);
    const zip = await writeZip([{ name: 'top/' }, { name: 'top/a.txt', data: enc(text) }, { name: 'top/é.csv', data: enc('1') }, { name: 'top/empty', data: new Uint8Array(0) }], codec, T);
    const z = openZip(zip, codec);
    expect(z.entries.map((e) => e.name)).toEqual(['top/', 'top/a.txt', 'top/é.csv', 'top/empty']);
    const a = z.entry('top/a.txt');
    if (a === undefined) throw new Error('missing');
    expect(a.method).toBe(8);
    expect(dec(await z.read(a))).toBe(text);
    const e = z.entry('top/é.csv');
    if (e === undefined) throw new Error('missing');
    expect(dec(await z.read(e))).toBe('1');
  });
});

describe('ZIP reader security controls', () => {
  it('rejects data that is not a ZIP archive', () => {
    expect(() => openZip(enc('not a zip file at all, really not'), nodeCodec)).toThrow(/not a ZIP archive/);
    expect(() => openZip(new Uint8Array(3), nodeCodec)).toThrow(/not a ZIP archive/);
  });

  it('rejects unsafe entry names (path traversal, absolute, backslash, control characters)', () => {
    for (const bad of ['../evil', 'a/../../b', '/etc/passwd', 'C:/x', 'a\\b', 'a/./b', 'a//b', `a${String.fromCharCode(0)}b`, '', 'x'.repeat(600)]) {
      expect(() => {
        checkEntryName(bad);
      }, JSON.stringify(bad)).toThrow();
      if (bad !== '') expect(() => openZip(rawZip([{ name: bad, data: enc('x') }]), nodeCodec), JSON.stringify(bad)).toThrow();
    }
    expect(() => {
      checkEntryName('ok/dir/');
    }).not.toThrow();
  });

  it('rejects duplicate names and a file that is also a directory', () => {
    expect(() => openZip(rawZip([{ name: 'a', data: enc('1') }, { name: 'a', data: enc('2') }]), nodeCodec)).toThrow(/twice/);
    expect(() => openZip(rawZip([{ name: 'a', data: enc('1') }, { name: 'a/b', data: enc('2') }]), nodeCodec)).toThrow(/both a file and a directory/);
  });

  it('rejects encryption, unknown methods, ZIP64 and a local name that differs', () => {
    expect(() => openZip(rawZip([{ name: 'a', data: enc('1'), flags: 0x0801 }]), nodeCodec)).toThrow(/Encrypted/);
    expect(() => openZip(rawZip([{ name: 'a', data: enc('1'), method: 12 }]), nodeCodec)).toThrow(/unsupported compression method/);
    expect(() => openZip(rawZip([{ name: 'a', data: enc('1') }], { zip64Locator: true }), nodeCodec)).toThrow(/ZIP64/);
    expect(() => openZip(rawZip([{ name: 'a', data: enc('1'), localName: 'b' }]), nodeCodec)).toThrow(/different name/);
  });

  it('rejects a declared size above the entry or total limit (zip bomb)', () => {
    const z = rawZip([{ name: 'a', data: enc('x'), method: 8, size: 10_000 }]);
    expect(() => openZip(z, nodeCodec, { maxEntries: 10, maxEntrySize: 1000, maxTotalSize: 10_000, maxRatio: 100_000 })).toThrow(/more than 1000 bytes/);
    const two = rawZip([{ name: 'a', data: enc('xx'), size: 2 }, { name: 'b', data: enc('yy'), size: 2 }]);
    expect(() => openZip(two, nodeCodec, { maxEntries: 10, maxEntrySize: 1000, maxTotalSize: 3, maxRatio: 100 })).toThrow(/more than 3 bytes/);
  });

  it('rejects an extreme compression ratio', () => {
    const big = deflateRawSync(new Uint8Array(1_000_000));
    const z = rawZip([{ name: 'a', data: new Uint8Array(big), method: 8, size: 1_000_000, crc: crc32(new Uint8Array(1_000_000)) }]);
    expect(() => openZip(z, nodeCodec)).toThrow(/compression ratio/);
    expect(() => openZip(z, nodeCodec, { maxEntries: 10, maxEntrySize: 2_000_000, maxTotalSize: 2_000_000, maxRatio: 10_000 })).not.toThrow();
  });

  it.each([
    ['node:zlib', nodeCodec],
    ['Compression Streams', streamCodec],
  ] as [string, DeflateCodec][])('stops inflating at the declared size when the size is a lie (%s)', async (_n, codec) => {
    const big = new Uint8Array(200_000).fill(65);
    const z = rawZip([{ name: 'a', data: new Uint8Array(deflateRawSync(big)), method: 8, size: 1000, crc: crc32(big) }]);
    const zip = openZip(z, codec);
    const e = zip.entry('a');
    if (e === undefined) throw new Error('missing');
    await expect(zip.read(e)).rejects.toThrow(/cannot be inflated within its declared size/);
  });

  it('checks CRC-32 and the inflated size', async () => {
    const z = rawZip([{ name: 'a', data: enc('hello'), crc: 1 }]);
    const zip = openZip(z, nodeCodec);
    const e = zip.entry('a');
    if (e === undefined) throw new Error('missing');
    await expect(zip.read(e)).rejects.toThrow(/CRC-32/);
    const short = rawZip([{ name: 'a', data: new Uint8Array(deflateRawSync(enc('hi'))), method: 8, size: 5, crc: crc32(enc('hi')) }]);
    const zs = openZip(short, nodeCodec);
    const es = zs.entry('a');
    if (es === undefined) throw new Error('missing');
    await expect(zs.read(es)).rejects.toThrow(/declared size/);
  });

  it('rejects entries whose data overlap (overlapping-file zip bomb)', () => {
    // Entry "a" contains, inside its data, a complete local record for entry "b".
    const inner = new Uint8Array(30 + 1 + 2);
    const v = new DataView(inner.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(26, 1, true);
    inner.set(enc('b'), 30);
    inner.set(enc('zz'), 31);
    const z = rawZip([{ name: 'a', data: inner }, { name: 'b', data: enc('zz'), offset: 31, crc: crc32(enc('zz')) }]);
    expect(() => openZip(z, nodeCodec)).toThrow(/overlap/);
  });

  it('rejects a deflated entry that declares data but has no compressed bytes', () => {
    const z = rawZip([{ name: 'a', data: new Uint8Array(0), method: 8, size: 10 }]);
    expect(() => openZip(z, nodeCodec)).toThrow(/impossible compression ratio/);
  });

  it('counts every extraction against the total limit, also when an entry is read again', async () => {
    const z = rawZip([{ name: 'a', data: enc('12345') }]);
    const zip = openZip(z, nodeCodec, { maxEntries: 10, maxEntrySize: 10, maxTotalSize: 8, maxRatio: 10 });
    const e = zip.entry('a');
    if (e === undefined) throw new Error('missing');
    expect(dec(await zip.read(e))).toBe('12345');
    await expect(zip.read(e)).rejects.toThrow(/would pass 8 bytes/);
  });

  it('caps the number of entries', () => {
    const many = rawZip(Array.from({ length: 5 }, (_x, i) => ({ name: `f${i}`, data: enc('x') })));
    expect(() => openZip(many, nodeCodec, { maxEntries: 4, maxEntrySize: 10, maxTotalSize: 10, maxRatio: 10 })).toThrow(/more than 4 entries/);
  });

  it('refuses to write unsafe or duplicate names', async () => {
    await expect(writeZip([{ name: '../x', data: enc('1') }], nodeCodec, T)).rejects.toThrow();
    await expect(writeZip([{ name: 'a', data: enc('1') }, { name: 'a', data: enc('2') }], nodeCodec, T)).rejects.toThrow(/Duplicate/);
  });

  it('is deterministic for the same input and time', async () => {
    const a = await writeZip([{ name: 'x/a', data: enc('1') }], nodeCodec, T);
    const b = await writeZip([{ name: 'x/a', data: enc('1') }], nodeCodec, T);
    expect(a).toEqual(b);
  });
});
