#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateFalconAccount } from '../src/accounts.ts';

let values: { out?: string };
try {
  ({ values } = parseArgs({
    options: {
      out: { type: 'string' },
    },
    strict: true,
  }));
} catch {
  console.error('Usage: npm run --silent generate:pq -- [--out account.json]');
  process.exit(1);
}

const account = generateFalconAccount();
const json = `${JSON.stringify(account, null, 2)}\n`;
if (values.out) {
  writeFileSync(values.out, json);
}
console.error('Falcon-1024 account. Keep seedHex secret; this command does not store it.');
process.stdout.write(json);
