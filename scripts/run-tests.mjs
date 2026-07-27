// Cross-platform test runner for node:test with .ts type stripping.
// node --test does not expand glob patterns on all shells, so we collect
// the matching files ourselves and pass them explicitly.

import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// env.ts reads this at module load time, so it must be set before the
// child process starts. We generate an ephemeral 32-byte key for the test
// run; no real secret is stored in the repository.
process.env.BOOKING_TOKEN_ENCRYPTION_KEY ??=
  randomBytes(32).toString('hex');

const ROOT = 'src/lib';
const files = [];

function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
}

collect(ROOT);

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    '--experimental-loader',
    './scripts/ts-resolve-loader.mjs',
    '--experimental-strip-types',
    '--test',
    ...files,
  ],
  {
    stdio: 'inherit',
    shell: false,
  },
);

process.exit(result.status ?? 1);
