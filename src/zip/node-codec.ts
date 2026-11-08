// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { DeflateCodec } from './codec.ts';

/**
 * Codec for Node.js, based on `node:zlib`. `maxOutputLength` makes zlib stop
 * as soon as the output would pass the limit, so a zip bomb never expands
 * in memory beyond it.
 */
export const nodeCodec: DeflateCodec = {
  inflateRaw(data, maxOutput) {
    return Promise.resolve(new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, maxOutput) })));
  },
  deflateRaw(data) {
    return Promise.resolve(new Uint8Array(deflateRawSync(data, { level: 9 })));
  },
};
