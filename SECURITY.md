# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:
<https://github.com/afkzonagroup/roster/security/advisories/new>. Do not open
a public issue. If you cannot use GitHub, email info@afkzonagroup.lt.

Include the version, what you did, what happened, and a minimal example
**without a real register of information**. We aim to acknowledge reports
within five working days and to agree a disclosure date with you.

Supported versions: the latest release.

## Threat model

### Assets

- **The register of information**: every ICT contract of a financial entity,
  its providers, costs, critical functions, exit plans and substitutability.
  Confidential business data; it can also name individuals acting in a
  business capacity (natural-person providers, passport or national
  identification numbers in B_05.01).
- **The report package** sent to the competent authority: its correctness
  matters legally, and a manipulated package could misreport the entity.
- **The user's machine**: files the CLI reads and writes; the terminal; the
  browser running the offline app.

### Actors

- The **compliance or IT analyst** who runs Roster (trusted, may make
  mistakes).
- A **hostile file**: workbooks and CSV files pass through many hands
  (providers fill in questionnaires, consultants send templates). A file may
  be crafted to exhaust memory (zip bomb, huge sheet), to read local files
  (XML external entities), to run code (formulas, macros), to escape the
  output folder (path traversal), or to inject formulas into the CSV files
  people open later.
- A **hostile contributor** proposing code or data changes.
- A **network attacker**, relevant only if code tried to use the network.

### Trust boundaries

1. Input files (.xlsx, .csv, .zip, roster.json) → importers and validator.
2. Validated data → output files (report package, working CSV files,
   findings reports) opened by people, spreadsheets and supervisors' systems.
3. The offline app page ↔ the network.
4. Command line arguments and the GitHub Action inputs → the file system and
   `$GITHUB_OUTPUT`.
5. Official source files → the generated taxonomy data.
6. Contributions → the released package.

### Mitigations

| Threat | Mitigation | Test |
|---|---|---|
| Zip bomb in a workbook or package | Central directory parsed first; declared sizes checked against per-entry and total limits before inflating; compression ratio limit; inflation stops at the declared size (`maxOutputLength` in Node, counted stream in the browser); size and CRC-32 verified; overlapping entries rejected | `zip.test.ts`, `xml-xlsx.test.ts` |
| Hostile ZIP structure | Path traversal, absolute, backslash and control-character names rejected; duplicate names, file/directory clashes, encryption, ZIP64, multi-disk and unknown methods rejected; local header must match | `zip.test.ts` |
| XML external entities, entity expansion | Any document type declaration is rejected before parsing; only the five predefined entities and character references are understood; depth, element and attribute limits | `xml-xlsx.test.ts` |
| Huge sheets or CSV files (memory, CPU) | File size limits before reading; row, column, cell, shared-string and value-length limits in workbooks; record, field and length limits in CSV; finding count limit | `xml-xlsx.test.ts`, `csv.test.ts`, `rules.test.ts`, `cli.test.ts` |
| Formulas and macros in workbooks | Formulas are never evaluated; the cached value is used and reported, or rejected with `--reject-formulas`; macro, external link and embedded object parts are never opened; relationships cannot point outside the package | `xml-xlsx.test.ts`, `import.test.ts` |
| CSV (formula) injection in files people open | Working CSV files and findings CSV prefix formula-like values with `'` (also after spaces, also full-width forms); the importer removes it again; formula-like text in the register is flagged (`roster.formula-like`). The report package keeps values exactly as reported, as the taxonomy requires | `csv.test.ts`, `cli.test.ts`, `validate-columns.test.ts` |
| Silent data changes | Strict UTF-8 (invalid bytes rejected, never replaced); strict RFC 4180 parsing; values never trimmed; conversions (labels to codes) only when unambiguous and reported; unknown settings keys are errors | `csv.test.ts`, `import.test.ts`, `explain-config.test.ts` |
| Spoofed values (Trojan Source style) | Bidirectional, zero-width and C1 control characters flagged; control characters not allowed by xBRL-CSV rejected | `validate-columns.test.ts` |
| Terminal escape injection | Every value, file name and path printed is made printable (`\u{..}` escapes); no stack traces | `cli.test.ts` |
| Path traversal and file overwrite | Output names are fixed or built from validated parts; files created with `O_EXCL` (no overwrite without `--force`), `O_NOFOLLOW` and mode 0600; folders 0700; symbolic links are not read or followed (last path component) | `cli.test.ts` |
| Data leaving the machine | No network code in the library, CLI or app (checked); offline app CSP `default-src 'none'`, `connect-src 'none'`, script and style allowed only by hash, Trusted Types; links only to fixed pages; no telemetry, no browser storage | `source-hygiene.test.ts`, `app-build.test.ts`, `app-dom.test.ts` |
| Script injection in the offline app | DOM built with `createElement` and `textContent` only; attribute allow-list; lint rules forbid HTML sinks | `app-build.test.ts`, `app-dom.test.ts`, lint |
| Injection through GitHub Action inputs | Inputs reach the script only as environment variables and separate arguments; `$GITHUB_OUTPUT` gets only counts and a validated path from the current run's in-memory result | `action.test.ts`, `cli.test.ts` |
| Tampered official sources | Every source file is checked against its SHA-256 before the generator uses it; generated data records the checksums | `taxonomy.test.ts` |
| Malicious rule data | Validation rules are parsed into a closed syntax tree and interpreted; no `eval`; regular expressions from the official file are accepted only from a safe character set | `rules.test.ts` |
| Supply chain | Zero runtime dependencies; exact devDependency versions; lockfile; no install scripts; `ignore-scripts=true`; pinned action SHAs; Docker base image pinned by digest; image runs as a non-root user without npm | `source-hygiene.test.ts`, `action.test.ts` |

### Data flows

Roster reads the files you name, keeps the register in memory, and writes
only the files you ask for (report package, working CSV files, settings).
Nothing is sent anywhere. The offline app reads files you choose with the
browser's File API and creates downloads as `blob:` URLs. The Docker image
needs no network (`--network none` works).

### What Roster does not protect against

- A compromised machine or browser.
- Mistakes in the register itself: Roster checks the format and the rules
  that can be evaluated offline, not whether the contracts are complete or
  correct.
- Validity of LEIs and EUIDs in GLEIF and BRIS (not checked; offline).

## Docker

Run the image with `--network none --cap-drop=ALL --security-opt
no-new-privileges --read-only` and mount only the folder with the register.
