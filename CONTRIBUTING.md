# Contributing

Thank you for helping. Roster prepares regulatory reports, so correctness and
security come first.

## Before you start

- Open an issue to discuss larger changes.
- Pull requests require the [Contributor Licence Agreement](CLA.md). Add the
  signature line from CLA.md to your first pull request.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Never put a real register of information in issues, tests or fixtures.
  Registers contain confidential contract data. Use synthetic data.

## Development

```sh
npm ci
npm run check        # typecheck + lint + tests with coverage
npm run build        # library, CLI and dist/app/roster.html
```

Python package:

```sh
python3 -m venv python/.venv
python/.venv/bin/pip install ./python
cd python/tests && ../.venv/bin/python -I -m unittest discover -s .
```

## Official data

`src/data/dora-4.0.json` is generated, never edited by hand:

```sh
npm run sources:fetch       # downloads the official files into .sources/ and checks SHA-256
npm run taxonomy:generate   # writes src/data/dora-4.0.json
npm run vectors:generate    # rewrites the shared test vectors
cp src/data/dora-4.0.json python/src/roster/data/
```

The sources and their checksums are listed in `scripts/sources.json`. When
the EBA publishes a new taxonomy or validation rules file, add it there with
its checksum, regenerate, and explain every change in the data in the pull
request. Requires Node.js 22.18 or later (TypeScript scripts run directly).

## Rules

- TypeScript strict mode, no `any`, no `@ts-ignore`; `eslint-disable` only
  with a written reason.
- No runtime dependencies.
- No column, closed list or validation rule typed by hand: they come from
  the official files through the generator.
- Every check cites its source: the article or annex of Regulation (EU)
  2022/2554 or Implementing Regulation (EU) 2024/2956 on EUR-Lex, an EBA
  validation rule, an ESAs technical check, the EBA filing rules, or an XBRL
  specification. Add it to `src/explain/catalogue.ts`.
- Every check needs a test that fails without it, and, if it is a register
  check, a case in the shared vectors that the Python port also passes.
- Every security control needs a test that fails when the control is removed.
- Keep the attribution "Roster by AFKzona Group" in interfaces and reports
  (LICENSE-ADDITIONAL-TERMS.md).
- Update CHANGELOG.md.
