#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { verifyBundle } from '../src/bundle.ts';
import { assertMainNet, createAlgorandClient } from '../src/client.ts';
import { loadDotEnv } from '../src/env.ts';

loadDotEnv();

let values: { bundle?: string; chain?: boolean };
try {
  ({ values } = parseArgs({
    options: {
      bundle: { type: 'string' },
      chain: { type: 'boolean', default: false },
    },
    strict: true,
  }));
} catch {
  values = {};
}

if (!values.bundle) {
  console.error('Usage: npm run --silent verify -- --bundle bundle.json [--chain]');
  process.exit(1);
}

try {
  const bundle: unknown = JSON.parse(readFileSync(values.bundle, 'utf8'));
  const algorand = values.chain ? createAlgorandClient() : undefined;
  if (algorand) {
    await assertMainNet(algorand);
  }
  const verified = await verifyBundle(bundle, { chain: values.chain, algorand });
  console.log(`verified ${verified.source.txnId} hash ${verified.source.hashSha256}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
