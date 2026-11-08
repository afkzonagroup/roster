// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy } from '../taxonomy/types.ts';

/** Where a row came from, for messages: a file or worksheet and its line or row number. */
export interface RowOrigin {
  readonly source: string;
  readonly line: number;
}

/**
 * One row of a template. `values` holds only reported cells, keyed by
 * column code (`c0010`); a missing key means the cell is empty. Values are
 * kept exactly as read, without trimming or case changes.
 */
export interface RegisterRow {
  readonly values: Readonly<Record<string, string>>;
  readonly origin: RowOrigin;
}

/** The rows of one template. */
export interface RegisterTable {
  readonly template: string;
  readonly rows: readonly RegisterRow[];
}

/**
 * A register of information: the rows of each template of the ITS
 * (B_01.01 ... B_99.01). Every template of the taxonomy is present, possibly
 * with no rows.
 */
export interface Register {
  readonly tables: ReadonlyMap<string, RegisterTable>;
}

/** Creates a register from rows per template; missing templates get no rows. */
export function makeRegister(rows: ReadonlyMap<string, readonly RegisterRow[]>, taxonomy: Taxonomy = DORA_4_0): Register {
  const tables = new Map<string, RegisterTable>();
  for (const t of taxonomy.templates) tables.set(t.code, { template: t.code, rows: rows.get(t.code) ?? [] });
  return { tables };
}

/** Number of data rows in all templates. */
export function rowCount(register: Register): number {
  let n = 0;
  for (const t of register.tables.values()) n += t.rows.length;
  return n;
}
