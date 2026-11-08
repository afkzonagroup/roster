// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Error raised for input that Roster refuses to process: malformed or
 * oversized files, hostile archives, invalid configuration. The message is
 * safe to show to a user; it never contains a stack trace or raw bytes.
 */
export class RosterInputError extends Error {
  /** Stable machine-readable code, for example `zip.bomb` or `csv.unterminated-quote`. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RosterInputError';
    this.code = code;
  }
}

/** Throws a {@link RosterInputError}. Helper for expression positions. */
export function fail(code: string, message: string): never {
  throw new RosterInputError(code, message);
}
