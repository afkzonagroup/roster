# Review record

Two review passes were made after the build, as required for every project of
this family. This file records what was checked, what was found and what was
fixed. The coordinator's and the independent review follow separately.

## Pass 1: correctness, law, edge cases, API, tests

### Checked

- Every requirement against the official texts: DORA Articles 2, 3, 28 and 64
  (EUR-Lex), Implementing Regulation (EU) 2024/2956 in full (Articles 1 to 7,
  Annex I with all column instructions, the B_99.01 table), Implementing
  Regulation (EU) 2021/1042 Annex point 9 (EUID).
- The taxonomy version: EBA reporting framework pages 4.0 to 4.3 and the
  DORA preparation page (all read 8 November 2026). 4.0 errata 5 is the DORA
  release in force; 4.2 says its DORA version "will not be applied"; 4.3 has
  no DORA module.
- The generated data against the official files: 15 templates, 120 columns,
  22 reference keys, 21 closed lists, 638 labels, 71 rules (49 active), 41
  ESAs checks, 8 external checks; the ITS-to-taxonomy column mapping
  (`src/data/column-mapping.txt`) line by line, including B_06.01 (FAQ 46)
  and B_99.01.
- The writer against the EBA DORA sample package: same files, same
  reportPackage.json, report.json and parameter names; the sample passes the
  reader's technical checks with no findings.
- Every column of every template with valid and invalid values (tests
  generated from the data); every reference key broken and repaired; every
  completeness rule broken; special rules one by one.
- The README quick start from a packed tarball in an empty folder, and the
  README library and Python examples (tested).
- The offline app at desktop and phone width in headless Chromium: example
  register, package download, EBA sample package, rule explanations; no
  console errors, no network requests, no horizontal scroll.

### Found and fixed

1. B_02.01.0030 has fill-in option "Mandatory" but its instruction starts
   "Not applicable if ... standalone"; every standalone contract got a false
   "mandatory" warning. The generator now treats such columns as conditional.
2. `decimalsMonetary: "INF"` was written as `INF`, which is not a valid
   xBRL-CSV decimals value. Now written as `#none` (xBRL-CSV 1.0, 3.1.13) and
   read back.
3. An empty register validated without settings passed silently. ESAs check
   724 (no data) now always applies.
4. The B_99.01 option names were empty in the generated data (nested table
   cells). Fixed in the ITS parser; all 19 rows map to the taxonomy columns.
5. ESAs check 332 (boolean metrics) was listed as checked; the DORA module has
   no boolean metrics. Now "not applicable".
6. Phone layout of the offline app scrolled sideways (long file names, wide
   table). Findings now stack on narrow screens; explanations open under the
   finding.
7. `roster import` could write part of a folder and then stop on an existing
   file. It now checks every target first.
8. Country labels in the taxonomy are upper case; test expectations corrected
   (label matching on import was already case-insensitive).
9. A fresh clone in a long folder path failed a test: printed paths were cut
   at 120 characters, hiding the file name in messages. Paths are now printed
   in full (up to 512 characters, still made printable).

## Pass 2: security and hostile input

### Checked

Every line of the security checklist of GOAL.md and GOAL2.md: no `eval`,
`new Function`, dynamic `import()`, `child_process` or HTML sinks in sources
(tested); input validation and limits at every boundary; safe paths and file
modes; no network in library, CLI or app; strict CSP; supply chain (zero
runtime dependencies, exact versions, lockfile, no install scripts, pinned
action SHAs, base image by digest); `npm audit --omit=dev` clean; Docker
image run with `--network none --cap-drop=ALL --security-opt
no-new-privileges --read-only` as a non-root user without npm.

Attacks tried with tests: zip bombs (declared size lies, ratio, total size,
overlapping entries), path traversal and absolute names, duplicate names,
encryption, ZIP64, XXE and entity expansion in worksheets, relationships
pointing outside the package or to external targets, huge sheets (rows,
columns, cells, string length, sheet count), formula cells including a DDE
style formula, Excel error cells, malformed CSV, invalid UTF-8, CSV formula
injection in every CSV the tool writes, invisible and bidirectional
characters, terminal escape sequences in file names, symbolic links on read
and write, overwrite of existing files, internal errors (no stack trace),
injection through GitHub Action inputs and `$GITHUB_OUTPUT`, hostile values
in report packages (`#nil`, unknown special values, extra parameters, wrong
entry point).

Each security control was removed one at a time and the test suite run
(37 controls). All but three made a test fail at once; those three were
fixed (below), after which every removal fails a test.

### Found and fixed

1. A regular expression in the rule data with nested quantifiers (for
   example `(a+)+`) would have been compiled; a tampered data file could
   cause catastrophic backtracking. Such patterns are now refused (TypeScript
   and Python), with a timing test.
2. A GitHub Action `input` starting with `--` would have been read as an
   option. The CLI now supports `--` (end of options) and the action passes
   the input after it.
3. Control tests that did not fail when the control was removed: the
   unquoted CSV field length check was duplicated (redundant copy removed);
   `O_NOFOLLOW` on reading was covered only by an earlier `lstat` (direct test
   added); the `$GITHUB_OUTPUT` path filter had no hostile case (test with a
   newline in the folder name added).
4. A hostile contributor could hand-edit `src/data/dora-4.0.json`. Added the
   "Verify generated data" workflow: it downloads the official sources,
   checks their SHA-256, regenerates the data, vectors and coverage document,
   and fails on any difference (pull requests touching data or scripts, and
   on demand).
5. The file-writing tool turned `\u` escapes into raw invisible characters in
   several files (a known wave-1 problem). All were replaced by escapes; the
   hygiene test scans every tracked text file, including Python sources and
   the generated vectors, which now write such characters as escapes.

### Accepted, documented

- `O_NOFOLLOW` protects only the last path component; folders named by the
  user are trusted.
- The library entry point imports `node:zlib` (for `nodeCodec`); browser
  bundles import the modules directly, as the offline app does.
- LEI and EUID validity in GLEIF and BRIS is not checked (offline by design).
- The report package keeps values that look like formulas exactly as
  reported (the taxonomy requires the reported value); Roster warns
  (`roster.formula-like`) instead.

## Results

- `npm run check`: typecheck, lint and 1311 tests pass; coverage 94.7 %
  statements, 86.1 % branches, 96.5 % functions, 98.3 % lines.
- Python: 8 tests, including all 647 shared register vectors and the
  identifier vectors.
- `npm audit --omit=dev`: 0 vulnerabilities.

## Independent review

A separate review on 8 November 2026, made without relying on the two passes
above. Official sources were read directly: Regulation (EU) 2022/2554 and
Implementing Regulations (EU) 2024/2956 and 2021/1042 (EUR-Lex and the
Publications Office), the EBA taxonomy package 4.0 errata 5, the EBA
validation rules files of 20 March 2025 and 12 October 2026, the ESAs
overview of RoI checks (28 April 2025), the EBA filing rules v5.9, the ESAs
DORA RoI FAQ (28 March 2025), the EBA "Observations from RoI reporting
testing" (April 2025) and the xBRL-CSV 1.0 specification.

### Checked and found correct

- All 15 templates and 120 columns against the taxonomy JSON files, with a
  separate script: column codes, data types, key columns, primary keys, the
  22 reference keys and all 21 closed lists. Only whitespace in two reference
  key names differs (normalised on purpose).
- The ITS Annex I mapping: column names, types and fill-in options of all
  columns, the B_06.01 renumbering (the Official Journal skips 0050), and
  the B_99.01 rows against the dimensions of the taxonomy columns.
- All 71 DORA rows of the validation rules file (expression, active,
  severity) with a separate spreadsheet reader.
- report.json, META-INF/reportPackage.json, parameters.csv
  (`entityID` `rs:<LEI>.CON|IND`, `refPeriod`, `baseCurrency`, decimals of
  -4 or more, `#none` for INF as xBRL-CSV 1.0 section 3.1.9 requires),
  FilingIndicators.csv and the file name, against the EBA sample package,
  filing rules v5.9 (rule 3.6, file naming section) and FAQ question 24.
- DORA Articles 28(3), 28(9) and 64; ITS Articles 2 to 6; the EUID structure
  (Implementing Regulation (EU) 2021/1042, Annex, point 9; FAQ question 45);
  reference date 31 December of the preceding year from 2026 (FAQ question
  13). Framework 4.0 errata 5 is still the package the EBA DORA page lists.
- The README quick start from a packed tarball in an empty folder (after the
  fix of finding 1), and 58 security controls by removing each one and
  running the tests (see finding 5).
- The Docker image, built and run as the README shows (no network, no
  capabilities, read-only, unprivileged user).

### Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | `.npmrc` sets `ignore-scripts=true`, so `prepack` never runs, and the release workflow published without building. `npm pack` produced a tarball of 8 files without `dist/`: the published package would have had no library and no `roster` command. | Fixed: release and CI build first and `scripts/check-pack.mjs` refuses a tarball without the compiled entry points. |
| 2 | Medium | Values starting with `#` passed validation and were written as `##...`. The EBA filing rules v5.9 ("xBRL-CSV reports extra rules", rule 5) forbid any value starting with `#` in fact or key columns. | Fixed: new error `eba-fr.csv-special` (TypeScript and Python, shared vector). |
| 3 | Medium | B_03.01.0020 rejected an EUID with an `its.lei` error, although its ITS instruction allows "the LEI ... or the EUID". | Fixed: the generator marks the column, the validators accept the EUID structure there. |
| 4 | Medium | The report package reader accepted empty header cells and rows with another number of fields than the header (EBA filing rules, xBRL-CSV extra rules 2 and 3; ESAs checks 801 and 809). | Fixed in TypeScript and Python. |
| 5 | Medium | Pass 2 says every security control makes a test fail when removed. Nine of 58 did not: the zero compressed size and the extraction total of the ZIP reader, the shared string count and length limits of the XLSX reader, the regular-file check, `O_NOFOLLOW` on `$GITHUB_OUTPUT`, mode 0700 of new folders, the 64-file cap and escaping of the input name in reports. | Fixed: tests added; all 58 removals now fail a test. |
| 6 | Low | B_02.01.0030 for standalone and overarching arrangements: FAQ question 124 asks for "Not applicable", the taxonomy reference key R13 (ESAs check 807) rejects it. Roster reports "Not applicable" as esa.807 and accepts an empty cell, which the FAQ says should not be left blank. | Open: needs confirmation by the ESAs or the competent authority; documented in docs/legal-basis.md. |
| 7 | Low | The EBA deactivated e23674_e to e23792_e (except e23681_e) and v22912_m after the ESAs overview and the March 2025 rules file, which still list them as active. Not documented. | Fixed: documented in docs/legal-basis.md. |
| 8 | Low | The Python CSV folder reader checked for a link and then opened the file (race). | Fixed: opened with `O_NOFOLLOW`. |
| 9 | Low | A damaged table file inside a report package (CRC error) stops `validate` with exit code 2 instead of an esa.103 finding. Safe, but less helpful. | Open. |
| 10 | Low | `npm audit` (development dependencies only) reports a moderate denial-of-service advisory in `minimatch` through ESLint and typescript-eslint. The runtime has no dependencies. | Open: upstream. |
| 11 | Info | The release workflow runs on `release: published` as well as on demand. It is not a CI run on push and matches the other repositories of the family. | Left as is. |
| 12 | Info | Rules with `default: 0` that use `isnull` (v8803_m, v8804_m, v8805_m, v8825_m) treat a missing value as null. The EBA does not publish how its engine applies the default to `isnull`. | Not verifiable. |

### Not verified

- How the ESAs' check 807 treats the text "Not applicable" in reference key
  columns, and whether national competent authority portals accept the
  package unchanged.
- The offline web app in a browser (not changed by this review).

### Results after the review

- `npm run check`: typecheck, lint and 1318 tests pass.
- Python: 9 tests, including all 649 shared register vectors.
- `npm audit --omit=dev`: 0 vulnerabilities.

## Coordinator review (8 Nov 2026)

No new findings. Checked:
- **The high finding** of the independent review (an empty npm package) is fixed: release and CI build first, and `scripts/check-pack.mjs` checks the tarball. The same defect was then found and fixed in three wave-1 repos.
- **The B_02.01.0030 handling:** "Not applicable" is flagged because the taxonomy's reference-key check would reject the package, and the FAQ conflict is documented for the authority to settle.
- **Workflow triggers:** pull requests, manual runs and published releases only.
- **`npm run check`:** 1318 tests pass.
