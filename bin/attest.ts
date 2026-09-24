#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { attestTransaction } from '../src/bundle.ts';
import { assertMainNet, createAlgorandClient } from '../src/client.ts';
import { loadDotEnv } from '../src/env.ts';
import { resolveSourceRequest } from '../src/source.ts';

loadDotEnv();

let values: { txid?: string; out?: string };
try {
  ({ values } = parseArgs({
    options: {
      txid: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  }));
} catch {
  values = {};
}

if (!values.txid) {
  console.error('Usage: npm run --silent attest -- --txid <ALGO_TXN_ID|BASE_TX_HASH> [--out bundle.json]');
  process.exit(1);
}

try {
  const algorand = createAlgorandClient();
  await assertMainNet(algorand);
  const source = resolveSourceRequest(values.txid);
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
