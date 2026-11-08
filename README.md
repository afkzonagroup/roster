# Roster

Roster builds and checks the DORA register of information and writes the
xBRL-CSV report package that competent authorities collect. It runs offline:
a command line tool, a library, a single-file web app, a Python package, a
GitHub Action and a Docker image.

## Why

Under [Article 28(3) of Regulation (EU) 2022/2554](https://eur-lex.europa.eu/eli/reg/2022/2554/oj)
(DORA), financial entities keep a register of information on all contractual
arrangements on the use of ICT services provided by ICT third-party service
providers, at entity level and at sub-consolidated and consolidated levels.
DORA applies from 17 January 2025. The templates are set by
[Commission Implementing Regulation (EU) 2024/2956](https://eur-lex.europa.eu/eli/reg_impl/2024/2956/oj).
Competent authorities collect the registers and pass them to the European
Supervisory Authorities as xBRL-CSV report packages of the
[EBA DORA taxonomy](https://www.eba.europa.eu/risk-and-data-analysis/reporting/reporting-frameworks/reporting-framework-40).
The ESAs do not accept Excel.

Many small payment institutions, investment firms and crypto-asset service
providers keep the register in a spreadsheet. Roster reads that spreadsheet,
checks it against the official templates and rules, explains every finding
with its source, and writes the package.

## What it checks

- Data types, closed lists and key columns of the EBA DORA taxonomy 4.0.
- Duplicate keys and all 22 reference keys between templates (for example,
  every contract in B_02.02 must exist in B_02.01).
- LEI format and check digits (ISO 17442), EUID structure.
- ITS rules: mandatory columns, natural numbers, the rank of a provider, the
  function identifier, maximum lengths.
- The 49 active EBA validation rules of the DORA framework, evaluated from
  their official DPM-XL expressions (the 22 deactivated ones on request).
- The ESAs technical checks of the report package (file name, structure,
  parameters, filing indicators, CSV format).

[docs/coverage.md](docs/coverage.md) lists every official check and whether
Roster runs it. Roster cannot check LEIs against GLEIF or EUIDs against BRIS,
because it works offline.

## Quick start

Node.js 22 or later.

```sh
npm install @afkzona/roster
npx roster init my-register --example
npx roster validate my-register
npx roster package my-register --out-dir out
npx roster explain esa.807
```

`init --example` writes a small fictional register (a payment institution with
two ICT contracts). Without `--example` the CSV files contain only the column
codes. `init --xlsx` writes one Excel workbook instead.

## Input formats

**Excel workbook (.xlsx).** One sheet per template, named after it (`B_02.01`,
`B.02.01` or `b 02 01`). The header row holds the column codes: `c0010`,
`0010` or `B_02.01.0010`. Rows right below the header that only repeat column
names or types are skipped. Other sheets (instructions, lists) are ignored.
Closed-list columns accept the taxonomy code (`eba_GA:LU`), the ISO code
(`LU`, `EUR`) or the English label of the taxonomy (`Luxembourg`, `Credit
institutions`). Formulas are never run: Roster uses the value saved in the
file and says so, or refuses them with `--reject-formulas`. The draft "RT"
templates of the 2024 dry run are not accepted.

**CSV files.** One UTF-8 file per template, named `b_01.01.csv` to
`b_99.01.csv`, with the column codes in the first row. This is also the
format `roster import` writes.

**Report package (.zip).** A package written by Roster or another tool.
Roster checks the package and the register inside it.

Use the taxonomy column codes. For B_06.01 they differ from the numbers
printed in the Official Journal (see [docs/legal-basis.md](docs/legal-basis.md)).
`roster explain B_06.01` shows both.

## Command line

```text
roster init <folder> [--example] [--xlsx] [--force]
roster import <input> --out <folder> [--force] [--reject-formulas]
roster validate <input> [--config <file>] [--reference-date <date>] [--no-reporting]
                        [--include-inactive] [--format text|json|csv]
                        [--fail-on error|warning|never] [--max-findings <n>] [--github-output]
roster package <input> [--out-dir <folder>] [--config <file>] [--force]
roster explain <rule | template | column> | --list
```

Exit codes: 0 no findings at the `--fail-on` level, 1 findings, 2 usage or
input error. `package` writes nothing when there are errors, unless `--force`.
Files are created with mode 0600 and never overwritten without `--force`.

## Configuration: roster.json

```json
{
  "consolidation": "IND",
  "referenceDate": "2025-12-31",
  "baseCurrency": "EUR",
  "decimalsMonetary": -3,
  "decimalsInteger": 0
}
```

| Setting | Meaning | Default |
|---|---|---|
| `lei` | LEI of the reporting entity (file name and `entityID`) | B_01.01 c0010 |
| `consolidation` | `CON` (consolidated or sub-consolidated) or `IND` (individual) | required |
| `country` | ISO 3166-1 alpha-2 code for the file name | B_01.01 c0030 |
| `referenceDate` | `yyyy-mm-dd`; from 2026 the ESAs use 31 December of the preceding year | required |
| `baseCurrency` | ISO 4217 code of monetary amounts | required |
| `decimalsMonetary` | accuracy of amounts, -4 or more, or `"INF"` (EBA filing rule 2.18) | -3 |
| `decimalsInteger` | 0 or `"INF"` | 0 |

Unknown settings are errors. Ask your competent authority which level, country
and channel it expects.

## Library

<!-- example:library -->
```ts
import { readFileSync, readdirSync } from 'node:fs';
import { buildPackage, importCsvFiles, nodeCodec } from '@afkzona/roster';

const dir = 'examples/register';
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.csv'))
  .map((name) => ({ name, bytes: readFileSync(`${dir}/${name}`) }));
const { register } = importCsvFiles(files);
const result = await buildPackage(register, { consolidation: 'IND', referenceDate: '2025-12-31', baseCurrency: 'EUR' }, nodeCodec);
if (result.ok) console.log(result.package.fileName, result.package.bytes.length);
else for (const f of result.check.findings) console.log(f.rule, f.template, f.row, f.message);
```

Main functions: `importXlsx`, `importCsvFiles`, `readReportPackage`,
`validateRegister`, `checkRegister`, `buildPackage`, `writeReportPackage`,
`explain`, `checkLei`. The taxonomy data is exported as `DORA_4_0`. All
functions work on bytes in memory; `nodeCodec` provides DEFLATE in Node.js.

## Offline web app

`npm run build` writes `dist/app/roster.html`, one file with everything
inside. Open it from disk in a current browser. It reads files you choose,
validates them, and builds the package as a download. Its Content Security
Policy blocks all network access (`default-src 'none'`, `connect-src
'none'`); the script and stylesheet are allowed only by hash.

## Python

Pure Python 3.10+, no dependencies. It validates a register with the same
checks and passes the same shared test vectors as the TypeScript package. It
reads CSV folders and report packages with codes; use `roster import` to
convert workbooks.

```sh
pip install ./python
```

<!-- example:python -->
```python
from roster import read_csv_folder, validate_register

register = read_csv_folder("examples/register")
findings, rules_run, not_run = validate_register(register, reporting=True, reference_date="2025-12-31")
for f in findings:
    print(f.severity, f.rule, f.template, f.row, f.column, f.message)
print(len(rules_run), "official rules run")
```

## GitHub Action

```yaml
- uses: afkzonagroup/roster@v0.1.0
  with:
    input: register            # folder, .xlsx or .zip in your repository
    fail-on: error
    package-dir: out           # optional: also write the report package
```

Outputs: `errors`, `warnings`, `package`. Inputs reach the scripts only as
environment variables.

## Docker

```sh
docker build -t roster .
docker run --rm --network none --cap-drop=ALL --security-opt no-new-privileges \
  --read-only -v "$PWD:/work" roster validate my-register
```

The image has no npm and runs as an unprivileged user.

## How it maps to the law

| Requirement | Source | Roster |
|---|---|---|
| Keep a register at entity, sub-consolidated and consolidated level | [DORA Art. 28(3)](https://eur-lex.europa.eu/eli/reg/2022/2554/oj) | `IND` and `CON` registers |
| Use the standard templates | [ITS Art. 3(1), 5(1), Annex I](https://eur-lex.europa.eu/eli/reg_impl/2024/2956/oj) | Templates B_01.01 to B_99.01 from the taxonomy |
| One value per data element, extra rows for more | ITS Art. 4(2) | Row model, duplicate key check |
| Valid LEI or EUID for providers that are legal persons | ITS Art. 3(5), 3(6) | Format and check digits only |
| Rank of providers in the supply chain | ITS Art. 2 | Rank 1 or more |
| Column instructions (mandatory, types, lengths) | ITS Annex I | ITS checks |
| Report to the competent authority on request | DORA Art. 28(3), 4th subpara. | xBRL-CSV report package |

Details and the points where official texts differ:
[docs/legal-basis.md](docs/legal-basis.md).

## Limitations

- Roster checks format and offline rules. It cannot tell whether your
  register is complete or whether your assessments are right.
- No check against GLEIF or BRIS.
- Only the DORA taxonomy 4.0 (reporting framework 4.0, errata 5). When the
  EBA publishes a new DORA release, the data must be regenerated.
- Excel: only `.xlsx`. No `.xls`, `.xlsb` or `.ods`; macros are never run.
- Competent authorities may add their own checks, channels and deadlines.

## Dependencies

None at run time. Development: TypeScript, ESLint, Vitest and esbuild (exact
versions in `package-lock.json`). The Python package has none.

The taxonomy data in `src/data/dora-4.0.json` is generated by
`scripts/generate-taxonomy.ts` from official files of the EBA and the
Publications Office of the European Union, listed with their SHA-256 in
`scripts/sources.json`. One EBA sample package is kept in `test/fixtures/eba`
for tests. EBA material is reproduced with acknowledgement of the source, as
the EBA's legal notice allows.

## Security

Inputs are treated as hostile: zip bomb, XML entity, path traversal and size
protections; formulas are never run; output files are protected against CSV
formula injection. Nothing leaves your machine. See [SECURITY.md](SECURITY.md)
for the threat model and how to report a vulnerability.

## Licence

AGPL-3.0-only with an attribution term (LICENSE-ADDITIONAL-TERMS.md): keep
"Roster by AFKzona Group" with its link in interfaces and reports. A
commercial licence without the AGPL obligations is available; see
[COMMERCIAL.md](COMMERCIAL.md). "Roster" is a trademark of MB AFKzona Group
([TRADEMARKS.md](TRADEMARKS.md)).

## Enterprise

MB AFKzona Group offers a commercial licence for organisations that cannot use
the AGPL-3.0 terms (including white-label use without the attribution
notice), integration into your systems, custom connectors and features, and
support agreements. Contact info@afkzonagroup.lt.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests need the
[CLA](CLA.md).

## Disclaimer

Roster is not legal advice. It does not make anyone compliant with DORA. Check
the official texts and your competent authority's instructions.

Maintained by AFKzona Group.
