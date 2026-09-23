#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateEd25519Account } from '../src/accounts.ts';

let values: { out?: string };
try {
  ({ values } = parseArgs({
    options: {
      out: { type: 'string' },
    },
    strict: true,
  }));
} catch {
  console.error('Usage: npm run --silent generate:ed25519 -- [--out account.json]');
  process.exit(1);
}

const account = generateEd25519Account();
const json = `${JSON.stringify(account, null, 2)}\n`;
if (values.out) {
  writeFileSync(values.out, json);
}
console.error('Ed25519 account. Keep the mnemonic secret; this command does not store it.');
process.stdout.write(json);
