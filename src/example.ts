// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { makeRegister, type Register, type RegisterRow } from './model/register.ts';
import { leiCheckDigits } from './validate/identifiers.ts';
import type { ReportSettings } from './package/settings.ts';

/** Builds a fictional LEI with correct check digits. The prefixes are made up and marked EXAMPLE. */
const lei = (prefix: string): string => `${prefix}${leiCheckDigits(prefix)}`;

/** Fictional identifiers used by the example register. */
export const EXAMPLE_IDS = Object.freeze({
  entity: lei('EXAMPLE0PAYMENTS01'),
  cloud: lei('EXAMPLE0CLOUDSAAS1'),
  datacentre: lei('EXAMPLE0DATACENTR1'),
  hostingEuid: 'LUEXAMPLE.B000001',
});

/** Settings of the example register. */
export const EXAMPLE_SETTINGS: ReportSettings = Object.freeze({
  lei: EXAMPLE_IDS.entity,
  consolidation: 'IND',
  country: 'LU',
  referenceDate: '2025-12-31',
  baseCurrency: 'EUR',
  decimalsMonetary: -3,
  decimalsInteger: 0,
});

/**
 * A small, complete and fictional register of information: a payment
 * institution that is not part of a group, with two ICT contracts, one
 * subcontractor and two functions. It passes every check Roster runs and is
 * meant for trying the tool and for tests. Names and identifiers are made up.
 */
export function exampleRegister(): Register {
  const { entity, cloud, datacentre, hostingEuid } = EXAMPLE_IDS;
  const rows = new Map<string, RegisterRow[]>();
  let line = 1;
  const add = (template: string, values: Record<string, string>): void => {
    const list = rows.get(template) ?? [];
    line++;
    list.push({ values, origin: { source: 'example', line } });
    rows.set(template, list);
  };
  add('B_01.01', { c0010: entity, c0020: 'Example Payments S.A.', c0030: 'eba_GA:LU', c0040: 'eba_CT:x300', c0050: 'Commission de Surveillance du Secteur Financier', c0060: '2026-01-15' });
  add('B_01.02', { c0010: entity, c0020: 'Example Payments S.A.', c0030: 'eba_GA:LU', c0040: 'eba_CT:x300', c0050: 'eba_RP:x21', c0060: entity, c0070: '2025-12-31', c0080: '2025-01-17', c0090: '9999-12-31', c0100: 'eba_CU:EUR', c0110: '125000000' });
  add('B_02.01', { c0010: 'EX-2025-001', c0020: 'eba_CO:x1', c0040: 'eba_CU:EUR', c0050: '120000' });
  add('B_02.01', { c0010: 'EX-2025-002', c0020: 'eba_CO:x1', c0040: 'eba_CU:EUR', c0050: '48000' });
  add('B_02.02', {
    c0010: 'EX-2025-001', c0020: entity, c0030: cloud, c0040: 'eba_qCO:qx2000', c0050: 'F1', c0060: 'eba_TA:S19', c0070: '2025-01-01', c0080: '2027-12-31',
    c0100: '90', c0110: '180', c0120: 'eba_GA:LU', c0130: 'eba_GA:IE', c0140: 'eba_BT:x28', c0150: 'eba_GA:IE', c0160: 'eba_GA:IE', c0170: 'eba_ZZ:x792', c0180: 'eba_ZZ:x796',
  });
  add('B_02.02', {
    c0010: 'EX-2025-002', c0020: entity, c0030: hostingEuid, c0040: 'eba_qCO:qx2002', c0050: 'F2', c0060: 'eba_TA:S07', c0070: '2025-03-01', c0080: '9999-12-31',
    c0130: 'eba_GA:qx2007', c0140: 'eba_BT:x29', c0150: 'eba_GA:qx2007', c0160: 'eba_GA:LU', c0170: 'eba_ZZ:x791',
  });
  add('B_03.01', { c0010: 'EX-2025-001', c0020: entity });
  add('B_03.01', { c0010: 'EX-2025-002', c0020: entity });
  add('B_03.02', { c0010: 'EX-2025-001', c0020: cloud, c0030: 'eba_qCO:qx2000' });
  add('B_03.02', { c0010: 'EX-2025-002', c0020: hostingEuid, c0030: 'eba_qCO:qx2002' });
  add('B_04.01', { c0010: 'EX-2025-001', c0020: entity, c0030: 'eba_ZZ:x839', c0040: 'Not applicable' });
  add('B_04.01', { c0010: 'EX-2025-002', c0020: entity, c0030: 'eba_ZZ:x839', c0040: 'Not applicable' });
  add('B_05.01', { c0010: cloud, c0020: 'eba_qCO:qx2000', c0050: 'Example Cloud Services Limited', c0060: 'Example Cloud Services Limited', c0070: 'eba_CT:x212', c0080: 'eba_GA:IE', c0090: 'eba_CU:EUR', c0100: '120000', c0110: cloud, c0120: 'eba_qCO:qx2000' });
  add('B_05.01', { c0010: hostingEuid, c0020: 'eba_qCO:qx2002', c0050: 'Example Hosting S.à r.l.', c0060: 'Example Hosting S.a r.l.', c0070: 'eba_CT:x212', c0080: 'eba_GA:LU', c0090: 'eba_CU:EUR', c0100: '48000', c0110: hostingEuid, c0120: 'eba_qCO:qx2002' });
  add('B_05.01', { c0010: datacentre, c0020: 'eba_qCO:qx2000', c0050: 'Example Data Centres B.V.', c0060: 'Example Data Centres B.V.', c0070: 'eba_CT:x212', c0080: 'eba_GA:NL', c0110: datacentre, c0120: 'eba_qCO:qx2000' });
  add('B_05.02', { c0010: 'EX-2025-001', c0020: 'eba_TA:S19', c0030: cloud, c0040: 'eba_qCO:qx2000', c0050: '1', c0060: cloud, c0070: 'eba_qCO:qx2000' });
  add('B_05.02', { c0010: 'EX-2025-001', c0020: 'eba_TA:S19', c0030: datacentre, c0040: 'eba_qCO:qx2000', c0050: '2', c0060: cloud, c0070: 'eba_qCO:qx2000' });
  add('B_05.02', { c0010: 'EX-2025-002', c0020: 'eba_TA:S07', c0030: hostingEuid, c0040: 'eba_qCO:qx2002', c0050: '1', c0060: hostingEuid, c0070: 'eba_qCO:qx2002' });
  add('B_06.01', { c0010: 'F1', c0020: 'eba_TA:x222', c0030: 'Card payment processing', c0040: entity, c0050: 'eba_BT:x28', c0060: 'Outage stops card payments for all customers.', c0070: '2025-06-30', c0080: '4', c0090: '1', c0100: 'eba_ZZ:x793' });
  add('B_06.01', { c0010: 'F2', c0020: 'eba_TA:x276', c0030: 'Internal document management', c0040: entity, c0050: 'eba_BT:x29', c0070: '2025-06-30', c0080: '72', c0090: '24', c0100: 'eba_ZZ:x791' });
  add('B_07.01', { c0010: 'EX-2025-001', c0020: cloud, c0030: 'eba_qCO:qx2000', c0040: 'eba_TA:S19', c0050: 'eba_ZZ:x960', c0060: 'eba_ZZ:x963', c0070: '2025-09-30', c0080: 'eba_BT:x28', c0090: 'eba_ZZ:x966', c0100: 'eba_ZZ:x793', c0110: 'eba_BT:x28', c0120: 'Two alternative providers were assessed in 2025.' });
  add('B_99.01', {
    c0010: 'A contract that does not depend on another contract.',
    c0040: 'Public or internal data only.',
    c0050: 'Customer data without payment card data.',
    c0100: 'No other provider can deliver the service within 12 months.',
    c0110: 'Moving the service would take more than 6 months.',
    c0150: 'Reintegration needs new staff and more than 6 months.',
    c0190: 'Customers cannot pay for more than 4 hours.',
  });
  return makeRegister(rows);
}
