# Roster for Python

Validates a DORA register of information (Regulation (EU) 2022/2554, Article
28(3); Implementing Regulation (EU) 2024/2956) offline, with the same checks
as the Roster TypeScript package: data types, closed lists, keys, reference
keys, LEI check digits, EUID structure, ITS checks and the active EBA
validation rules of the DORA taxonomy 4.0. Both implementations pass the same
shared test vectors.

Pure Python 3.10 or later, no dependencies, no network.

```python
from roster import read_csv_folder, validate_register

register = read_csv_folder("examples/register")
findings, rules_run, not_run = validate_register(register, reporting=True, reference_date="2025-12-31")
for f in findings:
    print(f.severity, f.rule, f.template, f.row, f.column, f.message)
```

`read_csv_folder` reads `b_01.01.csv` ... `b_99.01.csv` with taxonomy codes;
`read_report_package_tables` reads the tables of an xBRL-CSV report package.
To convert an Excel workbook, or to write a report package, use the Roster
command line tool (`roster import`, `roster package`). Roster does not check
LEIs against GLEIF or EUIDs against BRIS. Not legal advice.

Licence: AGPL-3.0-only with the attribution term in
LICENSE-ADDITIONAL-TERMS.md. Roster by AFKzona Group - https://afkzonagroup.lt
