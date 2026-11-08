# Coverage of the official checks

Generated from the rule catalogue and the official data (`npm run docs:coverage`). Do not edit by hand.

Taxonomy: EBA reporting framework 4.0, taxonomy package errata 5 (21 March 2025). Entry point: http://www.eba.europa.eu/eu/fr/xbrl/crr/fws/dora/4.0/mod/dora.json.

## ESAs technical checks for the register of information

Source: ESAs, overview of the RoI technical checks, validation rules and business checks (28 April 2025).

| Check | Description | Roster | How |
|---|---|---|---|
| 101 | Report filename extension must be zip | checked | File name ends with .zip (package reader); the writer always uses .zip. |
| 102 | SFTP report file size must not exceed 10GB | not-checked | Transport limit of the ESAs SFTP channel (10 GB); not relevant offline. |
| 103 | ZIP consistency (checksum, unzips correctly). | checked | ZIP structure, sizes and CRC-32 are verified on reading. |
| 104 | Filename allowed characters: alphanumeric plus hyphens ('-'), underscores ('_') and dots ('.') | checked | File name characters (package reader); the writer builds the name from validated parts. |
| 105 | Filename structure (ReportSubject_Country_FrameworkCodeModuleVersion_Module_ReferenceDate_CreationTimestamp) | checked | File name structure and top-level folder name (package reader); the writer builds the name. |
| 106 | Filename module inconsistency with the report category (SUP, REM, RES,PAY,DORA,PILLAR3) | checked | Framework code, module version and module in the file name. |
| 107 | For CA submitted reports, the submission path country must match the filename country code | not-checked | Depends on the competent authority submission path, which Roster does not know. |
| 109 | Filename reference date is valid date with format 'yyyy-mm-dd' | checked | Reference date format. |
| 110 | Each submitted report filename must be unique - duplicate filenames are not allowed | not-checked | Needs the history of earlier submissions. |
| 111 | Reference date in the filename cannot be in the future | checked | Reference date not after today. |
| 115 | DORA submitted report files must be a zip containing plain-csv | checked | The writer produces only plain-csv (xBRL-CSV) packages; the reader checks the structure. |
| 306 | XBRL instance documents must use UTF-8 encoding. | checked | Every file is decoded as strict UTF-8; invalid bytes are rejected. |
| 701 | CSV zip file must contain reports/report.json, reports/FilingIndicators.csv and reports/parameters.csv files and must be non-empty | checked | report.json, FilingIndicators.csv and parameters.csv exist and are not empty. |
| 702 | Invalid declarations in FilingIndicators.csv - wrong number of columns reported | checked | FilingIndicators.csv has two columns. |
| 703 | Each template can be declared only once in FilingIndicators.csv | checked | Each template once in FilingIndicators.csv. |
| 704 | Only boolean values (true, false, 1, 0) are allowed for any template code in FilingIndicators.csv | checked | Filing indicator values are booleans. |
| 705 | Missing filing indicator value - the true/false value is missing - only template code is present | checked | Filing indicator values are present. |
| 714 | The 'entityID' parameter must exist and its value must match filename | checked | entityID exists and matches the file name. |
| 720 | Valid table names must be used as .csv filenames | checked | Table file names are template file names of the module. |
| 723 | The header row in parameters.csv must consist only of the values name and value, in the first and second columns, respectively. | checked | parameters.csv header is name,value. |
| 724 | No data was integratable - integrated | checked | At least one data row in the register. |
| 801 | All the header column codes must be defined in the taxonomy json files (in DPM) | checked | Every header is a column code of the template in the taxonomy. |
| 802 | No column can be reported twice | checked | No column twice in a header. |
| 803 | For closed tables, all the row identifier must match those in the dpm | not-applicable | All DORA templates are open tables in the taxonomy; there are no closed-table row identifiers. |
| 804 | For closed tables, No row identifier can be reported twice | not-applicable | All DORA templates are open tables in the taxonomy; there are no closed-table row identifiers. |
| 805 | For open tables, the key columns values cannot be empty | checked | Key columns are never empty. |
| 807 | The reported data must follow the key-foreign key contraints defined in the DPM | checked | Every reference key of the taxonomy (tc:keys) matches a row of the target template. Rows whose reference columns are all empty are not checked. |
| 808 | All filing indicators have to be sent as true - and the templates reported empty if no data is present | checked | The writer reports every template as true; the reader flags false. |
| 809 | CSV formatting problem detected | checked | CSV is parsed strictly per RFC 4180 as amended by xBRL-CSV 1.0. |
| 305 | Numeric fact must not be reported with a string value | checked | Monetary values must be numbers (xs:decimal). |
| 320 | Reference date inside an instance as well as within filename must be valid (FR 2.13, FR 2.10) | checked | refPeriod is a valid date and equals the reference date in the file name. |
| 330 | Date type metric must be reported with format 'yyyy-mm-dd' | checked | Dates are yyyy-mm-dd and real calendar dates. |
| 331 | Integer type metric must be reported with an integer | checked | Integers are integers. |
| 332 | Boolean type metric must be reported with a boolean value (true/false/1/0) | not-applicable | The DORA module has no boolean metrics (its data types are text, closed list, date, integer, monetary and true-only Link columns; see 333). |
| 333 | trueItemType must be reported with true value | checked | Link columns hold true; the writer fills them. |
| 503 | Extensible main property and explicit key dimension must only be reported with one of the restricted value of a hierarchy | checked | Closed-list columns hold a code of the taxonomy list. |
| 505 | Each report must contain a report.json and this one must point to entrypoint json file for the module | checked | report.json extends exactly the DORA 4.0 entry point. |
| 510 | The values of filing indicators MUST only be those given by the label resources with the role http://www.eurofiling.info/xbrl/role/filing-indicator-code (the values are also present in TemplateCode field of Template table in DPM) (FR 1.6.3) | checked | Filing indicator codes are templates of the module. |
| 512 | The module referenced by the instance document must not refer to a taxonomy having FromDate = ToDate | by-construction | Roster only uses the DORA 4.0 module, which has FromDate 2025-03-31 and no ToDate. |
| 514 | Reporting subject must include entity type with '.' qualifier if the reference date is on or after 2022-12-31, and the module code does not contain CON or IND | checked | entityID has the .CON or .IND qualifier. |
| 806 | For open tables, you cannot have multiple rows with identical key values | checked | No two rows of a template with the same key values (a template without key columns can have one row). |

## EBA validation rules (framework DORA)

Source: EBA validation rules from framework 4.0, update of 12 October 2026. 71 rules, 49 active. Roster evaluates every active rule from its DPM-XL expression. Deactivated rules run only with `--include-inactive`. All have the official severity "warning".

| Rule | Tables | Status | Roster |
|---|---|---|---|
| e23674_e | B_05.01 | deactivated | checked with --include-inactive |
| e23675_e | B_01.03 | deactivated | checked with --include-inactive |
| e23676_e | B_01.02 | deactivated | checked with --include-inactive |
| e23677_e | B_01.01 | deactivated | checked with --include-inactive |
| e23680_e | B_02.02 | deactivated | checked with --include-inactive |
| e23681_e | B_07.01 | deactivated | checked with --include-inactive |
| e23682_e | B_06.01 | deactivated | checked with --include-inactive |
| e23683_e | B_04.01 | deactivated | checked with --include-inactive |
| e23792_e | B_02.01 | deactivated | checked with --include-inactive |
| v22912_m | B_02.01 | deactivated | checked with --include-inactive |
| v22913_s | B_01.02 | active | checked |
| v23716_s | B_02.01 | active | checked |
| v8803_m | B_01.02 | active | checked |
| v8804_m | B_01.02 | active | checked |
| v8805_m | B_02.01 | active | checked |
| v8816_m | B_02.02 | deactivated | checked with --include-inactive |
| v8817_m | B_05.01 | deactivated | checked with --include-inactive |
| v8818_m | B_05.01 | deactivated | checked with --include-inactive |
| v8821_m | B_05.01 | deactivated | checked with --include-inactive |
| v8823_m | B_05.01 | deactivated | checked with --include-inactive |
| v8824_m | B_05.01 | deactivated | checked with --include-inactive |
| v8825_m | B_07.01 | active | checked |
| v8826_m | B_01.02 | active | checked |
| v8850_m | B_05.01 | active | checked |
| v8851_m | B_05.01 | active | checked |
| v8852_m | B_05.01 | active | checked |
| v8853_m | B_05.01 | active | checked |
| v8854_m | B_05.01 | active | checked |
| v8855_m | B_05.01 | active | checked |
| v8856_m | B_01.03 | active | checked |
| v8857_m | B_01.03 | active | checked |
| v8858_m | B_01.02 | active | checked |
| v8859_m | B_01.02 | active | checked |
| v8860_m | B_01.02 | active | checked |
| v8861_m | B_01.02 | active | checked |
| v8862_m | B_01.02 | active | checked |
| v8863_m | B_01.02 | active | checked |
| v8864_m | B_01.02 | active | checked |
| v8865_m | B_01.02 | active | checked |
| v8866_m | B_02.01 | active | checked |
| v8867_m | B_02.01 | active | checked |
| v8868_m | B_02.01 | active | checked |
| v8869_m | B_02.02 | active | checked |
| v8870_m | B_02.02 | active | checked |
| v8871_m | B_02.02 | active | checked |
| v8872_m | B_01.01 | active | checked |
| v8873_m | B_01.01 | active | checked |
| v8874_m | B_01.01 | active | checked |
| v8875_m | B_01.01 | active | checked |
| v8876_m | B_01.01 | active | checked |
| v8877_m | B_06.01 | active | checked |
| v8878_m | B_06.01 | active | checked |
| v8879_m | B_06.01 | active | checked |
| v8880_m | B_06.01 | active | checked |
| v8881_m | B_06.01 | active | checked |
| v8882_m | B_06.01 | active | checked |
| v8883_m | B_06.01 | active | checked |
| v8884_m | B_07.01 | active | checked |
| v8885_m | B_07.01 | active | checked |
| v8886_m | B_07.01 | active | checked |
| v8887_m | B_07.01 | deactivated | checked with --include-inactive |
| v8888_m | B_07.01 | active | checked |
| v88889_m | B_07.01 | active | checked |
| v8890_m | B_01.01 | active | checked |
| v8891_m | B_01.02 | active | checked |
| v8892_m | B_01.03 | active | checked |
| v8893_m | B_02.02 | deactivated | checked with --include-inactive |
| v8894_m | B_03.01 | deactivated | checked with --include-inactive |
| v8895_m | B_03.03 | deactivated | checked with --include-inactive |
| v8896_m | B_04.01 | deactivated | checked with --include-inactive |
| v8897_m | B_06.01 | deactivated | checked with --include-inactive |

## Business checks against external databases

Roster works offline and never contacts GLEIF or BRIS.

| Check | Template | Column | Description | Roster |
|---|---|---|---|---|
| VR_2 | B_01.01 | c0010 | LEI code needs to be a valid one according to the GLEIF database | not checked; local format and check digit checks instead (its.lei, its.euid) |
| VR_12 | B_01.02 | c0010 | LEI code needs to be a valid one according to the GLEIF database | not checked; local format and check digit checks instead (its.lei, its.euid) |
| VR_16 | B_01.02 | c0030 | Code needs to be a valid one according to the GLEIF database | not checked; local format and check digit checks instead (its.lei, its.euid) |
| VR_23 | B_01.02 | c0060 | LEI code needs to be a valid one according to the GLEIF database | not checked; local format and check digit checks instead (its.lei, its.euid) |
| VR_71 | B_05.01 | c0010 | LEI code neeeds to be a valid one according to the GLEIF database (when b_05_01_c0020 = 'LEI') | not checked; local format and check digit checks instead (its.lei, its.euid) |
| VR_72 | B_05.01 | c0010 | EUID code needs to be a valid one according to the BRIS (when b_05_01_c0020 = 'EUID') | not checked; local format and check digit checks instead (its.lei, its.euid) |
| VR_77 | B_05.01 | c0030 | LEI code neeeds to be a valid one according to the GLEIF database (when b_05_01_c0040 = 'LEI') | not checked; local format and check digit checks instead (its.lei, its.euid) |
| VR_78 | B_05.01 | c0030 | EUID code needs to be a valid one according to the BRIS (when b_05_01_c0040 = 'EUID') | not checked; local format and check digit checks instead (its.lei, its.euid) |

## Checks Roster adds from the ITS, the EBA filing rules and the XBRL specifications

| Rule | Title | Source |
|---|---|---|
| its.lei | LEI structure and check digits | ITS Article 3(5) and the column instructions ("LEI, 20-character, alpha-numeric code based on the ISO 17442 standard") |
| its.euid | EUID structure | ITS Article 3(5) and B_05.01.0010; Implementing Regulation (EU) 2021/1042, Annex, point 9; ESAs DORA FAQ question 45 |
| its.mandatory | Mandatory column is empty | ITS Annex I, "Fill-in Option" of each column ("Mandatory", "Mandatory in case of reporting") |
| its.natural-number | Natural number | ITS Annex I, column type "Natural number" |
| its.rank | Rank of a provider in the supply chain | ITS Article 2: the rank is a natural number of 1 or more; the direct provider has rank 1 |
| its.function-identifier | Function identifier | ITS Annex I, B_06.01.0010: "the letter F (capital letter) followed by a natural number" |
| its.max-length | Maximum length stated in the ITS | ITS Annex I, B_06.01.0070 (taxonomy c0060): "300 characters maximum" |
| xbrl-csv.character | Character not allowed in xBRL-CSV | xBRL-CSV 1.0 section 3.2.1 (TEXTDATA) |
| xbrl-csv.special-value | xBRL-CSV special value | xBRL-CSV 1.0 section 3.2.4 |
| eba-fr.csv-special | Value starting with # | EBA filing rules v5.9, "xBRL-CSV reports extra rules", rule 5: special values and "any value started with #" must not be used in fact or key columns |
| xbrl-csv.invalidParameterCSVFile | Invalid parameters.csv | xBRL-CSV 1.0 section 3.1.13 |
| xbrl-csv.unreferencedParameter | Parameter not used by the module | xBRL-CSV 1.0 section 3.2.6; EBA filing rules v5.9, xBRL-CSV reports (b) |
| eba-fr.1.5 | Entry point only through extends | EBA filing rule 1.5(a) |
| eba-fr.1.6 | Filing indicator for every template | EBA filing rule 1.6(d) |
| eba-fr.2.18 | Decimals | EBA filing rule 2.18: monetary decimals >= -4 for submissions from 1 April 2025, integers 0 |
| eba-fr.2.19 | No nil or empty facts | EBA filing rule 2.19 |
| roster.whitespace | Leading or trailing spaces | Roster data quality check (keys are compared exactly: xBRL-CSV table constraints use XML Schema equality) |
| roster.formula-like | Value that a spreadsheet could run as a formula | Roster safety check (CSV formula injection) |
| roster.suspicious-character | Invisible, bidirectional or C1 control character | Roster safety check |
| roster.settings | Report settings | EBA filing rules v5.9 (parameters) and the ESAs FAQ question 24 (file name) |
| rp.invalidDirectoryStructure | Single top-level folder | Report Package 1.0 section 4.1 |
| rp.missingReportPackageJson | META-INF/reportPackage.json | Report Package 1.0 section 4.4; EBA filing rules v5.9 (package structure) |
| rp.unsupportedReportPackageVersion | Report package document type | Report Package 1.0 section 4.4 |
| rp.invalidJSON | Invalid JSON | Report Package 1.0 section 9 |
| rp.missingReportsDirectory | reports folder | Report Package 1.0 section 4.7 |
| import.duplicate-template | Template given twice | Roster import |
| import.formula | Formula cells | Roster importer, security |
| import.cell-error | Excel error value | Roster import |
| import.outside-columns | Values outside the coded columns | Roster import |
| import.draft-template | Draft RT templates | Roster import |
| import.ignored-sheets | Sheets ignored | Roster import |
| import.converted | Values converted | Roster import |
| import.too-large | File too large | Roster importer, size limit |
