# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-08

### Added

- Generated data of the EBA DORA taxonomy 4.0 (reporting framework 4.0,
  errata 5): 15 templates, 120 columns, types, keys, 22 reference keys,
  closed lists with labels; ITS column names, types and fill-in instructions
  from Implementing Regulation (EU) 2024/2956; the 71 DORA validation rules
  of the EBA validation rules file (12 October 2026); the ESAs RoI technical
  checks. Sources are downloaded and checked by SHA-256.
- Register validator: data types, closed lists, keys and duplicate keys,
  reference keys, LEI check digits, EUID structure, ITS checks (mandatory
  columns, natural numbers, rank, function identifier, maximum length) and
  the active EBA validation rules evaluated from their DPM-XL expressions.
- Importers for Excel workbooks (.xlsx) and CSV files per template, with
  zip bomb, XML entity and size protections; formulas are never run.
- xBRL-CSV report package writer and reader (Report Package 1.0, EBA filing
  rules v5.9) with the ESAs technical checks that can run offline.
- `roster` command line tool: init, import, validate, package, explain.
- Offline single-file web app with a strict Content Security Policy.
- Python port of the validator (`afkzona-roster`), checked against the same
  shared test vectors.
- GitHub Action and Docker image.
- EBA filing rules, xBRL-CSV reports extra rules 2, 3 and 5: empty header
  cells and rows with another number of fields than the header are errors in
  report packages; values starting with `#` are errors.
- B_03.01.0020 accepts an EUID as well as an LEI, as its ITS instruction says.
