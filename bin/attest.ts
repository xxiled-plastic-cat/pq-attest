#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { attestTransaction } from '../src/bundle.ts';
import { assertMainNet, createAlgorandClient } from '../src/client.ts';
import { loadDotEnv } from '../src/env.ts';
import { resolveSourceRequest } from '../src/source.ts';

loadDotEnv();

let values: { txid?: string; chain?: string; out?: string };
try {
  ({ values } = parseArgs({
    options: {
      txid: { type: 'string' },
      chain: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  }));
} catch {
  values = {};
}

if (!values.txid || !values.chain) {
  console.error('Usage: npm run --silent attest -- --txid <id> --chain <network> [--out bundle.json]');
  process.exit(1);
}

try {
  const algorand = createAlgorandClient();
  await assertMainNet(algorand);
  const source = resolveSourceRequest(values.txid, values.chain);
  const bundle = await attestTransaction({
    algorand,
    txid: source.txid,
    chain: source.chain,
    mnemonic: process.env.ATTESTOR_MNEMONIC,
    falconSeed: process.env.ATTESTOR_FALCON_SEED,
  });
  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  if (values.out) {
    writeFileSync(values.out, json);
  }
  process.stdout.write(json);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
