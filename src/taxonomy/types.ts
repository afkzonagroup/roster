// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DPM data type of a column, as given by `eba:documentation/type` in the
 * taxonomy's xBRL-CSV metadata: `s` string, `e` enumeration (closed list),
 * `d` date, `i` integer, `m` monetary, `t` "true" item (always `true`).
 */
export type ColumnType = 's' | 'e' | 'd' | 'i' | 'm' | 't';

/** How the ITS fill-in option qualifies a column. */
export type ItsStatus = 'mandatory' | 'reporting' | 'optional' | 'conditional';

/** The ITS (Implementing Regulation (EU) 2024/2956, Annex I) description of a column. */
export interface ItsColumn {
  /** Column code as printed in the ITS, e.g. `B_02.02.0060`. */
  readonly code: string;
  readonly name: string;
  /** ITS type: Alphanumerical, Country, Currency, Date, Monetary, Natural number, Pattern, Closed set of options, [Yes/No]. */
  readonly type: string;
  readonly instruction: string;
  readonly fillIn: string;
  readonly status: ItsStatus;
}

/** One column of a template, from the EBA DORA taxonomy. */
export interface Column {
  /** xBRL-CSV column code, e.g. `c0010`. */
  readonly code: string;
  /** True for a key column (primary key field in the taxonomy). */
  readonly key: boolean;
  readonly type: ColumnType;
  /** Column header in the taxonomy (English label). */
  readonly label: string;
  /** For key columns: the typed or explicit dimension the column sets. */
  readonly dimension: string | null;
  readonly concept: string | null;
  /** Id of the closed list (see {@link Taxonomy.enumerations}), for `e` columns. */
  readonly enumeration: string | null;
  /** Parameter holding the decimals of numeric facts, e.g. `decimalsMonetary`. */
  readonly decimals: string | null;
  /** Parameter holding the unit, e.g. `baseCurrency`. */
  readonly unit: string | null;
  readonly its: ItsColumn | null;
  /** For a "type of code" column: the identification code column it describes. */
  readonly identifies: string | null;
  /** True when the ITS asks for an LEI (ISO 17442) in this column. */
  readonly lei: boolean;
  /** True when the ITS allows an EUID instead of the LEI in this column (B_03.01.0020: "LEI ... or the EUID"). */
  readonly euid: boolean;
  /** Maximum length in characters stated by the ITS, if any. */
  readonly maxLength: number | null;
}

/** A reference (foreign) key declared in the taxonomy (xBRL-CSV table constraints). */
export interface ReferenceKey {
  readonly name: string;
  readonly columns: readonly string[];
  /** Template whose primary key the columns refer to. */
  readonly target: string;
}

/** One template (table) of the register. */
export interface Template {
  /** Template code, e.g. `B_02.02`. Also the filing indicator. */
  readonly code: string;
  readonly tableId: string;
  readonly templateId: string;
  /** CSV file name in the report package, e.g. `b_02.02.csv`. */
  readonly file: string;
  readonly label: string;
  readonly itsName: string | null;
  readonly columns: readonly Column[];
  readonly primaryKey: readonly string[];
  readonly references: readonly ReferenceKey[];
}

/** A validation rule of the EBA validation rules file (DORA framework). */
export interface ValidationRule {
  readonly code: string;
  readonly source: string;
  readonly module: string;
  readonly tables: readonly string[];
  readonly expression: string;
  readonly precondition: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly severity: string;
  readonly fromReferenceDate: string | null;
  readonly toReferenceDate: string | null;
  readonly fromSubmissionDate: string | null;
  readonly implementedInXbrl: boolean;
  readonly parseError: string | null;
}

/** A check from the ESAs' overview of RoI technical checks. */
export interface TechnicalCheck {
  readonly code: string;
  readonly category: string;
  readonly description: string;
  readonly comment: string | null;
  readonly layer: 'technical' | 'dpm-technical';
}

/** A business check against an external database (GLEIF, BRIS). */
export interface ExternalCheck {
  readonly code: string;
  readonly type: string;
  readonly table: string;
  readonly column: string;
  readonly description: string;
  readonly prerequisite: string | null;
}

/** An official source file of the data, with its checksum. */
export interface DataSource {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly humanUrl: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** Facts about the taxonomy module. */
export interface Framework {
  readonly code: string;
  readonly release: string;
  readonly releaseLabel: string;
  readonly module: string;
  readonly moduleVersion: string;
  readonly fromReferenceDate: string;
  readonly toReferenceDate: string | null;
  readonly entryPoint: string;
  readonly reportDocumentType: string;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly jsonParameters: Readonly<Record<string, string>>;
  readonly filingIndicatorTable: string;
}

/** The generated taxonomy data (src/data/dora-4.0.json). */
export interface Taxonomy {
  readonly format: number;
  readonly framework: Framework;
  readonly templates: readonly Template[];
  readonly enumerations: Readonly<Record<string, readonly string[]>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly rules: readonly ValidationRule[];
  readonly checks: readonly TechnicalCheck[];
  readonly externalChecks: readonly ExternalCheck[];
  readonly sources: readonly DataSource[];
}
