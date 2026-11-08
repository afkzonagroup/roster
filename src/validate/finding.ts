// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `error`: the data breaks the ITS, the taxonomy or a check that makes the
 * ESAs reject the file. `warning`: a data quality finding (for example an
 * official validation rule with severity "warning", or a missing mandatory
 * value). `info`: context, nothing to fix.
 */
export type Severity = 'error' | 'warning' | 'info';

/** One problem found in a register or report package. */
export interface Finding {
  /** Rule identifier; `roster explain <rule>` shows its source. */
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
  readonly template?: string;
  readonly column?: string;
  /** 1-based data row within the template. */
  readonly row?: number;
  /** Source file or worksheet and line, when known. */
  readonly source?: string;
  readonly line?: number;
  /** The offending value, shortened and made printable. */
  readonly value?: string;
}

/** Collects findings up to a limit, so a hostile file cannot flood memory. */
export class FindingSink {
  readonly findings: Finding[] = [];
  readonly limit: number;
  truncated = 0;

  constructor(limit: number) {
    this.limit = limit;
  }

  add(f: Finding): void {
    if (this.findings.length < this.limit) this.findings.push(f);
    else this.truncated++;
  }
}

/** Counts findings by severity. */
export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}
