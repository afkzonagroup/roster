// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { encodeUtf8 } from '../util/text.ts';
import { escapeXml } from '../xml/sax.ts';
import type { DeflateCodec } from '../zip/codec.ts';
import { writeZip, type ZipInput } from '../zip/write.ts';
import { fail } from '../util/errors.ts';

/** A worksheet to write: rows of text cells. */
export interface SheetInput {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

/** Converts a 1-based column index to letters (1 = A). */
export function columnLetters(index: number): string {
  let n = index;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * Writes a minimal `.xlsx` workbook with text cells only (inline strings).
 * Used for the editable template written by `roster init --xlsx` and for
 * tests. Values are written as text, never as formulas.
 */
export async function writeXlsx(sheets: readonly SheetInput[], codec: DeflateCodec, modified: Date): Promise<Uint8Array> {
  const files: ZipInput[] = [];
  const add = (name: string, xml: string): void => {
    files.push({ name, data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`) });
  };
  add(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
  );
  add('_rels/.rels', `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add(
    'xl/workbook.xml',
    `<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets>${sheets
      .map((s, i) => {
        if (s.name.length === 0 || s.name.length > 31 || /[\\/?*[\]:]/.test(s.name)) fail('xlsx.bad-sheet-name', `Invalid worksheet name "${s.name}".`);
        return `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
      })
      .join('')}</sheets></workbook>`,
  );
  add(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="${PKG_REL_NS}">${sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  );
  sheets.forEach((sheet, i) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => (v === '' ? '' : `<c r="${columnLetters(c + 1)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`))
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    add(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${NS}"><sheetData>${rows}</sheetData></worksheet>`);
  });
  return writeZip(files, codec, modified);
}
