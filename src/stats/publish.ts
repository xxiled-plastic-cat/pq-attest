import { countAttestations } from './attestations.ts';
import { buildStatsDocument, type NfStatsDocument } from './document.ts';
import { uploadStats } from './upload.ts';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function collectStats(options: {
  env: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<NfStatsDocument> {
  const attestationsTotal = await countAttestations(options);
  return buildStatsDocument(attestationsTotal, options.now ?? new Date());
}

export async function publishStats(options: {
  env: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
}): Promise<NfStatsDocument> {
  const document = await collectStats(options);
  await uploadStats(document, options);
  return document;
}
