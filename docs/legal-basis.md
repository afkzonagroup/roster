# Legal and technical basis

Roster implements what the official texts say about the format and content of
the register of information. It does not interpret the substance of DORA (which
contracts, which functions are critical). This page maps each part of Roster to
its source. Quotes are from the official English texts.

## Law

| Source | What it says | Where Roster uses it |
|---|---|---|
| [Regulation (EU) 2022/2554 (DORA)](https://eur-lex.europa.eu/eli/reg/2022/2554/oj), Article 2(1) and (2) | The financial entities in scope, points (a) to (t). | The closed list of entity types in B_01.01 and B_01.02 (from the taxonomy). |
| DORA Article 28(3), first subparagraph | "financial entities shall maintain and update at entity level, and at sub-consolidated and consolidated levels, a register of information in relation to all contractual arrangements on the use of ICT services provided by ICT third-party service providers." | The register model (`IND` and `CON` levels). |
| DORA Article 28(3), fourth subparagraph | "Financial entities shall make available to the competent authority, upon its request, the full register of information ..." | The report package. |
| DORA Article 28(9) | The ESAs develop implementing technical standards "to establish the standard templates for the purposes of the register of information". | Templates from Implementing Regulation (EU) 2024/2956. |
| DORA Article 64 | "It shall apply from 17 January 2025." | Documentation. |
| [Implementing Regulation (EU) 2024/2956](https://eur-lex.europa.eu/eli/reg_impl/2024/2956/oj), Article 2 | The rank: "any natural number higher or equal to '1'"; the direct provider has rank 1. | Check `its.rank`. |
| ITS Article 3(5) and (6) | A "valid and active" LEI, or the EUID, for ICT third-party service providers that are legal persons. | Checks `its.lei` (format and check digits) and `its.euid` (structure). Activity in GLEIF and BRIS is not checked. |
| ITS Article 4 | Tables with a predefined number of columns and an indefinite number of rows; one value per data element, extra rows for more values. | The row model; duplicate key check. |
| ITS Article 5(1) and Annex I | The templates B_01.01 to B_99.01, every column, type, instruction and fill-in option. | All column descriptions (`roster explain B_02.02.0060`), check `its.mandatory`, `its.natural-number`, `its.function-identifier`, `its.max-length`. |
| ITS Annexes II to IV | Licensed activities, ICT service types, and the instructions for total assets. | Closed lists (from the taxonomy). |
| [Implementing Regulation (EU) 2021/1042](https://eur-lex.europa.eu/eli/reg_impl/2021/1042/oj), Annex, point 9 | The EUID contains a country code, a register identifier and a registration number. | Check `its.euid`. |

## Reporting format

| Source | Version | Where Roster uses it |
|---|---|---|
| [EBA reporting framework 4.0](https://www.eba.europa.eu/risk-and-data-analysis/reporting/reporting-frameworks/reporting-framework-40), taxonomy package errata 5 (21 March 2025), module `dora` 1.1.0, entry point `http://www.eba.europa.eu/eu/fr/xbrl/crr/fws/dora/4.0/mod/dora.json` | Applies from reference date 2025-03-31 and has no end date. Framework 4.2 states that its DORA version "will not be applied". Framework 4.3 (July 2026) has no DORA module. The EBA's DORA preparation page still points to 4.0. | Templates, columns, data types, keys, reference keys, closed lists and labels. |
| [EBA validation rules from framework 4.0](https://www.eba.europa.eu/risk-and-data-analysis/reporting/reporting-frameworks/validation-rules-packages), update of 12 October 2026 | 71 DORA rules, 49 active. | Official rules evaluated from their DPM-XL expressions. |
| [ESAs overview of RoI technical checks](https://www.eba.europa.eu/activities/direct-supervision-and-oversight/digital-operational-resilience-act/preparation-dora-application) (28 April 2025) | Technical checks 101 to 809, DPM technical checks, LEI and EUID business checks. | See [coverage.md](coverage.md). |
| [EBA XBRL filing rules v5.9](https://www.eba.europa.eu/sites/default/files/2026-07/020f25ef-fae1-4b0f-8df5-77f5f45747ec/eba_filing_rules_v5.9_2026_06_26.pdf) (26 June 2026) | File naming, package structure, parameters, filing indicators, decimals. | Package writer and reader. |
| [xBRL-CSV 1.0](https://www.xbrl.org/Specification/xbrl-csv/REC-2021-10-13+errata-2023-04-19/xbrl-csv-REC-2021-10-13+corrected-errata-2023-04-19.html) (Recommendation 2021-10-13, errata 2023-04-19) | CSV format, parameters file, special values. | CSV writer and parser. |
| [Report Package 1.0](https://www.xbrl.org/Specification/report-package/REC-2023-09-22+corrected-errata-2025-03-11/report-package-REC-2023-09-22+corrected-errata-2025-03-11.html) (Recommendation 2023-09-22, errata 2025-03-11) | Single top-level folder, META-INF/reportPackage.json, reports folder. | Package writer and reader. |
| [ESAs FAQ on reporting of the registers of information](https://www.eba.europa.eu/sites/default/files/2025-03/31bb6e60-7d10-4405-a8c5-9f04934630ac/20250328%20-%20DORA%20RoI%20reporting%20FAQ%20%28updated%29.pdf) (28 March 2025) | Not legal interpretation ("best efforts" answers of ESA staff). | Hints in messages only: file naming (question 24), "Not applicable" for key columns (questions 26, 59 to 65), B_06.01 numbering (question 46), Link columns (question 35), reference dates (question 13). |

## Where the official texts differ

- **B_06.01 column numbers.** The ITS in the Official Journal skips B_06.01.0050, so its columns 0060 to 0110 are the taxonomy's 0050 to 0100. The report package must use the taxonomy codes (ESAs FAQ question 46). Roster uses the taxonomy codes and shows both numbers in `roster explain`.
- **B_05.02.0060 and 0070.** The ITS says to leave them blank at rank 1; the taxonomy makes B_05.02.0060 a key column, which may not be empty (ESAs check 805). The ESAs answered (Q&A 147, FAQ question 65) that the value of B_05.02.0030 is reported. Roster follows the taxonomy and reports an empty key as an error.
- **Monetary columns and currency.** In the taxonomy every monetary amount uses the report's base currency (parameter `baseCurrency`); the ITS asks for the currency in separate columns. Roster writes the currency columns as given and does not convert amounts.
- **Validation rules marked "Implemented in XBRL: No".** Rules v8890_m to v8897_m read a key value through `[get DIM]`. Roster evaluates them as written; v8893_m to v8897_m (deactivated) name dimensions that are not keys of their table and are reported as not evaluable.
- **B_02.01.0030 for standalone and overarching arrangements.** The ITS says "Not applicable if the contractual arrangement is the 'overarching contractual arrangement' or a 'standalone arrangement'". The ESAs FAQ (question 124) says the field "cannot be left blank" and should hold the text "Not applicable". The taxonomy declares c0030 a reference key to B_02.01 c0010 (R13), and ESAs check 807 rejects a value that is not a contract reference number of B_02.01. Roster follows the taxonomy: an empty c0030 passes, "Not applicable" is reported as esa.807. Ask your competent authority which form it accepts.
- **B_03.01.0020.** The column is named "LEI of the entity signing the contractual arrangement", but its instruction allows "the LEI ... or the EUID". Roster accepts a value with the EUID structure there. The taxonomy reference key R2 still requires the value to be a B_01.02 c0010 entry.
- **Values starting with #.** xBRL-CSV 1.0 lets a report carry such a value written as `##...`. The EBA filing rules (xBRL-CSV reports extra rule 5) forbid any value starting with `#` in fact and key columns. Roster reports such values as errors (eba-fr.csv-special).
- **Deactivated validation rules.** The ESAs overview of RoI checks (28 April 2025) and the EBA validation rules of 20 March 2025 list the existence rules e23674_e to e23792_e (except e23681_e) and v22912_m as active. The EBA validation rules file of 12 October 2026 marks them inactive. Roster follows the latest file and runs them only with `--include-inactive`.
- **Rule v8883_m** lists c0020 twice in its condition where c0090 would be expected. Roster evaluates the expression as published.

## Not covered

- Whether the register is complete and correct.
- LEI and EUID status in GLEIF and BRIS (ESAs checks VR_2, VR_12, VR_16, VR_23, VR_71, VR_72, VR_77, VR_78).
- Checks across submissions (ESAs check 110) and of the competent authority's channel (102, 107).
- National reporting channels and deadlines set by competent authorities.
- The yearly report on new arrangements of DORA Article 28(3), third subparagraph.
