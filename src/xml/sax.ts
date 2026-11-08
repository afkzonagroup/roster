// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { fail } from '../util/errors.ts';

/** Event handlers for {@link parseXml}. Names are given without namespace prefix. */
export interface XmlHandlers {
  open?(name: string, attrs: ReadonlyMap<string, string>, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

/** Limits for XML parsing. */
export interface XmlLimits {
  readonly maxDepth: number;
  readonly maxElements: number;
  readonly maxAttributes: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = Object.freeze({ maxDepth: 64, maxElements: 50_000_000, maxAttributes: 64 });

const PREDEFINED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Replaces the five predefined entities and character references. Anything else is an error. */
export function decodeEntities(text: string, what: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&([^;&]{0,16});/g, (_m, ref: string) => {
    const pre = PREDEFINED[ref];
    if (pre !== undefined) return pre;
    let cp = Number.NaN;
    if (/^#x[0-9A-Fa-f]{1,6}$/.test(ref)) cp = Number.parseInt(ref.slice(2), 16);
    else if (/^#[0-9]{1,7}$/.test(ref)) cp = Number.parseInt(ref.slice(1), 10);
    if (!Number.isInteger(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0) {
      fail('xml.entity', `${what}: unsupported entity reference "&${ref};".`);
    }
    return String.fromCodePoint(cp);
  });
}

function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i < 0 ? qname : qname.slice(i + 1);
}

const NAME = /^[A-Za-z_][\w.:-]*$/;

/**
 * A small non-validating XML parser for the parts of an XLSX workbook.
 *
 * Security: document type declarations are rejected outright, so no
 * external entity (XXE), parameter entity or entity expansion ("billion
 * laughs") can ever be processed. Only the five predefined entities and
 * numeric character references are understood. Depth, element and attribute
 * counts are limited. Comments, processing instructions and CDATA are
 * handled; namespaces are reduced to local names.
 */
export function parseXml(text: string, what: string, handlers: XmlHandlers, limits: XmlLimits = DEFAULT_XML_LIMITS): void {
  const stack: string[] = [];
  let elements = 0;
  let i = 0;
  const n = text.length;
  let seenRoot = false;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      const rest = text.slice(i);
      if (stack.length > 0) handlers.text?.(decodeEntities(rest, what));
      else if (rest.trim() !== '') fail('xml.malformed', `${what}: text outside the root element.`);
      break;
    }
    if (lt > i) {
      const chunk = text.slice(i, lt);
      if (stack.length > 0) handlers.text?.(decodeEntities(chunk, what));
      else if (chunk.trim() !== '') fail('xml.malformed', `${what}: text outside the root element.`);
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) fail('xml.malformed', `${what}: unterminated comment.`);
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) fail('xml.malformed', `${what}: unterminated CDATA section.`);
      if (stack.length === 0) fail('xml.malformed', `${what}: CDATA outside the root element.`);
      handlers.text?.(text.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      // <!DOCTYPE ...> and any other markup declaration.
      fail('xml.doctype', `${what}: document type declarations are not allowed (protection against XML entity attacks).`);
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) fail('xml.malformed', `${what}: unterminated processing instruction.`);
      i = end + 2;
      continue;
    }
    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) fail('xml.malformed', `${what}: unterminated end tag.`);
      const qname = text.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (open !== qname) fail('xml.malformed', `${what}: end tag </${qname}> does not match <${open ?? ''}>.`);
      handlers.close?.(localName(qname));
      i = end + 1;
      continue;
    }
    // Start tag: find its end, respecting quoted attribute values.
    let j = lt + 1;
    let quote = 0;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (quote !== 0) {
        if (c === quote) quote = 0;
      } else if (c === 0x22 || c === 0x27) {
        quote = c;
      } else if (c === 0x3e) {
        break;
      } else if (c === 0x3c) {
        fail('xml.malformed', `${what}: "<" inside a tag.`);
      }
      j++;
    }
    if (j >= n) fail('xml.malformed', `${what}: unterminated start tag.`);
    let body = text.slice(lt + 1, j);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const m = /^([^\s/>]+)/.exec(body);
    const qname = m?.[1] ?? '';
    if (!NAME.test(qname)) fail('xml.malformed', `${what}: invalid element name.`);
    if (stack.length === 0 && seenRoot) fail('xml.malformed', `${what}: more than one root element.`);
    seenRoot = true;
    const attrs = new Map<string, string>();
    const attrText = body.slice(qname.length);
    const attrRe = /\s+([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/gy;
    let k = 0;
    for (;;) {
      attrRe.lastIndex = k;
      const am = attrRe.exec(attrText);
      if (am === null) break;
      const an = am[1] ?? '';
      if (!NAME.test(an)) fail('xml.malformed', `${what}: invalid attribute name.`);
      const local = localName(an);
      if (attrs.has(local) && !an.startsWith('xmlns')) fail('xml.malformed', `${what}: duplicate attribute "${an}".`);
      if (attrs.size >= limits.maxAttributes) fail('xml.limit', `${what}: too many attributes on one element.`);
      const value = am[3] ?? am[4] ?? '';
      if (value.includes('<')) fail('xml.malformed', `${what}: "<" in an attribute value.`);
      attrs.set(local, decodeEntities(value, what));
      k = attrRe.lastIndex;
    }
    if (attrText.slice(k).trim() !== '') fail('xml.malformed', `${what}: malformed attributes in <${qname}>.`);
    elements++;
    if (elements > limits.maxElements) fail('xml.limit', `${what}: more than ${limits.maxElements} elements.`);
    handlers.open?.(localName(qname), attrs, selfClosing);
    if (selfClosing) {
      handlers.close?.(localName(qname));
    } else {
      stack.push(qname);
      if (stack.length > limits.maxDepth) fail('xml.limit', `${what}: nesting deeper than ${limits.maxDepth} levels.`);
    }
    i = j + 1;
  }
  if (stack.length > 0) fail('xml.malformed', `${what}: unclosed element <${stack[stack.length - 1] ?? ''}>.`);
  if (!seenRoot) fail('xml.malformed', `${what}: no root element.`);
}

/** Escapes text for use in XML content or a double-quoted attribute. */
export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[c] ?? ''};`);
}
