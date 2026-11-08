// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Roster: builds and validates the DORA register of information
 * (Regulation (EU) 2022/2554, Article 28(3); Implementing Regulation (EU)
 * 2024/2956) and writes the xBRL-CSV report package of the EBA DORA
 * taxonomy 4.0. Works offline; nothing leaves the machine.
 *
 * @packageDocumentation
 */

export { ATTRIBUTION, ATTRIBUTION_URL, buildPackage, checkRegister, type BuildResult, type CheckOptions, type CheckResult } from './api.ts';
export { CONFIG_FILE, parseConfig, type RosterConfig } from './config.ts';
export { explain, renderExplanation, type Explanation } from './explain/explain.ts';
export { allRuleIds, describeRule, type Coverage, type RuleInfo } from './explain/catalogue.ts';
export { LINKS } from './explain/sources.ts';
export { importCsvFiles, type CsvImportOptions, type InputFile } from './import/csv.ts';
export { importXlsx, type XlsxImportOptions } from './import/xlsx.ts';
export type { ImportResult } from './import/common.ts';
export { makeRegister, rowCount, type Register, type RegisterRow, type RegisterTable, type RowOrigin } from './model/register.ts';
export { packageBaseName, parsePackageName } from './package/naming.ts';
export { readReportPackage, type PackageReadResult } from './package/read.ts';
export { checkSettings, settingsFromRegister, DEFAULT_DECIMALS, type ReportSettings } from './package/settings.ts';
export { tableCsv, writeReportPackage, type ReportPackage } from './package/write.ts';
export { DORA_4_0, allowedValues, findColumn, findTemplate, memberLabel } from './taxonomy/dora.ts';
export type { Column, ColumnType, DataSource, ExternalCheck, Framework, ItsColumn, ItsStatus, ReferenceKey, Taxonomy, Template, TechnicalCheck, ValidationRule } from './taxonomy/types.ts';
export { countBySeverity, type Finding, type Severity } from './validate/finding.ts';
export { checkEuid, checkLei, leiCheckDigits } from './validate/identifiers.ts';
export { validateRegister, type NotEvaluated, type RegisterValidation, type ValidateOptions } from './validate/register.ts';
export { RosterInputError } from './util/errors.ts';
export type { DeflateCodec } from './zip/codec.ts';
export { nodeCodec } from './zip/node-codec.ts';
export { VERSION } from './version.ts';
