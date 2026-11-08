// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { FIXED_LINKS, isAllowedHref } from '../src/app/dom.ts';

describe('offline app link allow-list', () => {
  it('allows only the fixed pages and blob downloads', () => {
    for (const ok of [...FIXED_LINKS, 'blob:null/1234']) expect(isAllowedHref(ok), ok).toBe(true);
  });

  it('rejects every other target, so no link can carry data off the machine', () => {
    for (const bad of ['https://evil.example/', 'https://afkzonagroup.lt/?lei=1', 'javascript:alert(1)', 'data:text/html,x', 'http://afkzonagroup.lt', '#top', 'https://eur-lex.europa.eu/eli/reg/2022/2554/oj?x=1']) {
      expect(isAllowedHref(bad), bad).toBe(false);
    }
  });
});
