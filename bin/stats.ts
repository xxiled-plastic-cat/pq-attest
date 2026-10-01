#!/usr/bin/env node
import { loadDotEnv } from '../src/env.ts';
import { collectStats, publishStats } from '../src/stats/publish.ts';

loadDotEnv();

const dry = process.argv.includes('--dry');

try {
  if (dry) {
    const document = await collectStats({ env: process.env });
    console.log(JSON.stringify(document, null, 2));
  } else {
    await publishStats({ env: process.env });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Stats publish failed.');
  process.exit(1);
}
