// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** Official documents Roster implements, with links. */
export const LINKS = Object.freeze({
  dora: { title: 'Regulation (EU) 2022/2554 (DORA)', url: 'https://eur-lex.europa.eu/eli/reg/2022/2554/oj' },
  its: { title: 'Commission Implementing Regulation (EU) 2024/2956 (ITS on the register of information)', url: 'https://eur-lex.europa.eu/eli/reg_impl/2024/2956/oj' },
  euid: { title: 'Commission Implementing Regulation (EU) 2021/1042, Annex, point 9 (EUID)', url: 'https://eur-lex.europa.eu/eli/reg_impl/2021/1042/oj' },
  xbrlCsv: {
    title: 'xBRL-CSV 1.0, Recommendation 13 October 2021 with errata to 19 April 2023',
    url: 'https://www.xbrl.org/Specification/xbrl-csv/REC-2021-10-13+errata-2023-04-19/xbrl-csv-REC-2021-10-13+corrected-errata-2023-04-19.html',
  },
  reportPackage: {
    title: 'Report Package 1.0, Recommendation 22 September 2023 with errata to 11 March 2025',
    url: 'https://www.xbrl.org/Specification/report-package/REC-2023-09-22+corrected-errata-2025-03-11/report-package-REC-2023-09-22+corrected-errata-2025-03-11.html',
  },
  tableConstraints: {
    title: 'xBRL-CSV Table Constraints 1.0, Public Working Draft 21 May 2024 (used by the taxonomy for keys)',
    url: 'https://www.xbrl.org/Specification/table-constraints/PWD-2024-05-21/table-constraints-PWD-2024-05-21.html',
  },
  filingRules: { title: 'EBA XBRL filing rules v5.9 (26 June 2026)', url: 'https://www.eba.europa.eu/sites/default/files/2026-07/020f25ef-fae1-4b0f-8df5-77f5f45747ec/eba_filing_rules_v5.9_2026_06_26.pdf' },
  checks: {
    title: 'ESAs: overview of the RoI technical checks, validation rules and business checks (28 April 2025)',
    url: 'https://www.eba.europa.eu/sites/default/files/2025-04/10100a51-275f-4c98-96a1-f81342a8f57d/Overview%20of%20the%20RoI%20reporting%20technical%20checks%20and%20validation%20rules%20%28updated%2028%20April%202025%29%20%284%29.xlsx',
  },
  validationRules: { title: 'EBA validation rules from framework 4.0 (latest update 12 October 2026)', url: 'https://www.eba.europa.eu/risk-and-data-analysis/reporting/reporting-frameworks/validation-rules-packages' },
  faq: {
    title: 'ESAs: Frequently asked questions on reporting of the registers of information (28 March 2025)',
    url: 'https://www.eba.europa.eu/sites/default/files/2025-03/31bb6e60-7d10-4405-a8c5-9f04934630ac/20250328%20-%20DORA%20RoI%20reporting%20FAQ%20%28updated%29.pdf',
  },
  framework40: { title: 'EBA reporting framework 4.0 (DORA taxonomy 4.0)', url: 'https://www.eba.europa.eu/risk-and-data-analysis/reporting/reporting-frameworks/reporting-framework-40' },
  preparation: {
    title: 'EBA: Preparations for reporting of DORA registers of information',
    url: 'https://www.eba.europa.eu/activities/direct-supervision-and-oversight/digital-operational-resilience-act/preparation-dora-application',
  },
});

export type LinkKey = keyof typeof LINKS;
