// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Writes docs/coverage.md from the rule catalogue. Requires Node >= 22.18.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { coverageMarkdown } from '../src/explain/coverage.ts';

writeFileSync(join(import.meta.dirname, '../docs/coverage.md'), coverageMarkdown());
