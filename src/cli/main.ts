#!/usr/bin/env node
// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import process from 'node:process';
import { nodeIo } from './node-io.ts';
import { run } from './run.ts';

process.exitCode = await run(process.argv.slice(2), nodeIo);
