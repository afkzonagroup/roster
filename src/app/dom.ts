// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Minimal DOM building for the offline app. Text always goes in as text
 * nodes; attributes are checked against an allow-list. There is no path from
 * data to HTML parsing.
 */

type Child = Node | string | null | undefined | false;
type Attrs = Readonly<Record<string, string | boolean | undefined>>;

const ALLOWED_ATTRIBUTES = new Set([
  'class', 'id', 'type', 'name', 'value', 'for', 'href', 'download', 'target', 'rel', 'role', 'accept', 'multiple', 'placeholder',
  'inputmode', 'autocomplete', 'maxlength', 'tabindex', 'scope', 'hidden', 'disabled', 'checked', 'spellcheck', 'title', 'pattern',
]);

/** The only pages the app links to. */
export const FIXED_LINKS: ReadonlySet<string> = new Set([
  'https://afkzonagroup.lt',
  'https://github.com/afkzonagroup/roster',
  'https://eur-lex.europa.eu/eli/reg/2022/2554/oj',
  'https://eur-lex.europa.eu/eli/reg_impl/2024/2956/oj',
  'https://www.eba.europa.eu/risk-and-data-analysis/reporting/reporting-frameworks/reporting-framework-40',
]);

/** Links may point only to fixed pages or to a local blob: download. */
export function isAllowedHref(value: string): boolean {
  return FIXED_LINKS.has(value) || value.startsWith('blob:');
}

function checkAttribute(name: string, value: string): void {
  if (!(ALLOWED_ATTRIBUTES.has(name) || name.startsWith('aria-') || name.startsWith('data-'))) throw new Error(`attribute not allowed: ${name}`);
  if (name === 'href' && !isAllowedHref(value)) throw new Error('link target not allowed');
}

/** Creates an element with checked attributes and text or node children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    const text = value === true ? '' : value;
    checkAttribute(name, text);
    el.setAttribute(name, text);
  }
  append(el, ...children);
  return el;
}

/** Appends text (as text nodes) and nodes. */
export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Removes all children. */
export function clear(el: Element): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}
