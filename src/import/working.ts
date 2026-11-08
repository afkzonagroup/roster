// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { writeSafeCsv } from '../csv/write.ts';
import type { Register } from '../model/register.ts';
import { columnOrder } from '../package/write.ts';
import { DORA_4_0 } from '../taxonomy/dora.ts';
import type { Taxonomy } from '../taxonomy/types.ts';
import { encodeUtf8 } from '../util/text.ts';
import type { InputFile } from './csv.ts';

/**
 * Writes a register as one working CSV file per template (`b_01.01.csv` ...),
 * with column codes in the first row. These files are meant to be edited and
 * read back with `importCsvFiles`. To protect people who open them in a
 * spreadsheet program, a value that could run as a formula is written with a
 * leading apostrophe; `importCsvFiles` removes it again.
 */
export function registerToCsvFiles(register: Register, taxonomy: Taxonomy = DORA_4_0): InputFile[] {
  return taxonomy.templates.map((t) => {
    const order = columnOrder(t).filter((c) => t.columns.find((x) => x.code === c)?.type !== 't');
    const rows = (register.tables.get(t.code)?.rows ?? []).map((r) => order.map((c) => r.values[c] ?? ''));
    return { name: t.file, bytes: encodeUtf8(writeSafeCsv([order, ...rows])) };
  });
}

/** Removes the apostrophe that {@link registerToCsvFiles} puts before formula-like values. */
export function unneutraliseFormula(value: string): string {
  return /^'[\s\u3000]*[=+\-@\t\r\n＝＋－＠]/.test(value) ? value.slice(1) : value;
}
