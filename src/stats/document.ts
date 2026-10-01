import packageJson from '../../package.json' with { type: 'json' };
import { BLOCK_CAPABILITIES } from '../block/capabilities.ts';

export const STATS_SCHEMA = 'nf-stats/v1' as const;
export const STATS_PROJECT = 'pq-attest' as const;
export const STATS_NAME = 'PQ Attest' as const;
export const STATS_URL = 'https://pqattest.com';

export interface NfStat {
  id: string;
  label: string;
  value: number;
  unit: string;
  period: string;
  as_of: string;
  source?: string;
}

export interface NfStatsDocument {
  schema: typeof STATS_SCHEMA;
  project: typeof STATS_PROJECT;
  name: typeof STATS_NAME;
  status: 'live';
  version: string;
  url: string;
  networks: string[];
  updated_at: string;
  stats: NfStat[];
}

export function supportedNetworks(): string[] {
  return BLOCK_CAPABILITIES.map((entry) => entry.network);
}

export function packageVersion(): string {
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json version is missing.');
  }
  return packageJson.version;
}

/** `released_at` is omitted: this repo does not record a release date for the version. */
export function buildStatsDocument(attestationsTotal: number, now: Date): NfStatsDocument {
  if (!Number.isInteger(attestationsTotal) || attestationsTotal < 0) {
    throw new Error('Attestation total must be a non-negative integer.');
  }
  const asOf = now.toISOString();
  const networks = supportedNetworks();
  return {
    schema: STATS_SCHEMA,
    project: STATS_PROJECT,
    name: STATS_NAME,
    status: 'live',
    version: packageVersion(),
    url: STATS_URL,
    networks,
    updated_at: asOf,
    stats: [
      {
        id: 'attestations_total',
        label: 'Attestations made',
        value: attestationsTotal,
        unit: 'count',
        period: 'all_time',
        as_of: asOf,
        source: 'Attest transactions written by the service',
      },
      {
        id: 'networks_supported',
        label: 'Networks supported',
        value: networks.length,
        unit: 'chains',
        period: 'current',
        as_of: asOf,
      },
    ],
  };
}
