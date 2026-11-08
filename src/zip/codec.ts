// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Raw DEFLATE (RFC 1951) compression used by ZIP archives. Node and the
 * browser provide different implementations; the ZIP code depends only on
 * this interface.
 */
export interface DeflateCodec {
  /**
   * Inflates raw DEFLATE data. Must stop and reject as soon as the output
   * would exceed `maxOutput` bytes (zip bomb protection).
   */
  inflateRaw(data: Uint8Array, maxOutput: number): Promise<Uint8Array>;
  /** Compresses data with raw DEFLATE, or returns `null` to store it uncompressed. */
  deflateRaw(data: Uint8Array): Promise<Uint8Array | null>;
}

/**
 * Codec for browsers, based on the Compression Streams API
 * (`DecompressionStream('deflate-raw')`). Output is counted while streaming
 * and the stream is cancelled once the limit is passed.
 */
export const streamCodec: DeflateCodec = {
  async inflateRaw(data, maxOutput) {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOutput) {
        await reader.cancel();
        throw new RangeError('inflated data exceeds the limit');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  },
  async deflateRaw(data) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },
};
