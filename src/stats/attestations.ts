import { falconAccountFromSeed, falconSeedFromHex } from '../accounts.ts';

/** Prefix of `attestNote` in src/bundle.ts. */
export const ATTEST_NOTE_PREFIX = 'attest:v1:';
/** Prefix of `blockAttestNote` in src/block/verify.ts. */
export const BLOCK_ATTEST_NOTE_PREFIX = 'block-attest:v1:';

const NOTE_PREFIXES = [ATTEST_NOTE_PREFIX, BLOCK_ATTEST_NOTE_PREFIX] as const;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 100;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function countAttestations(options: {
  env: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}): Promise<number> {
  const indexerUrl = options.env.INDEXER_URL?.trim();
  if (!indexerUrl) {
    throw new Error('INDEXER_URL is required.');
  }
  const address = falconAccountFromSeed(falconSeedFromHex(options.env.ATTESTOR_FALCON_SEED)).address;
  const fetchImpl = options.fetchImpl ?? fetch;
  let total = 0;
  for (const prefix of NOTE_PREFIXES) {
    total += await countNotePrefix(indexerUrl, address, prefix, options.env.INDEXER_TOKEN, fetchImpl);
  }
  return total;
}

async function countNotePrefix(
  indexerUrl: string,
  address: string,
  prefix: string,
  indexerToken: string | undefined,
  fetchImpl: FetchLike,
): Promise<number> {
  const notePrefix = Buffer.from(prefix, 'utf8').toString('base64');
  let total = 0;
  let next: string | undefined;
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const base = indexerUrl.endsWith('/') ? indexerUrl : `${indexerUrl}/`;
    const url = new URL('v2/transactions', base);
    url.searchParams.set('address', address);
    url.searchParams.set('address-role', 'sender');
    url.searchParams.set('note-prefix', notePrefix);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (next) {
      url.searchParams.set('next', next);
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    const token = indexerToken?.trim();
    if (token) {
      headers['X-Indexer-API-Token'] = token;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, { headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error.';
      throw new Error(`Indexer attestation search failed: ${message}`);
    }
    if (!response.ok) {
      throw new Error(`Indexer attestation search failed (${response.status}).`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Indexer attestation search returned an unexpected body.');
    }
    const parsed = parsePage(body);
    total += parsed.count;
    if (!parsed.next) {
      return total;
    }
    if (seen.has(parsed.next)) {
      throw new Error('Indexer attestation search repeated a page token.');
    }
    seen.add(parsed.next);
    next = parsed.next;
  }

  throw new Error('Indexer attestation search did not finish within 100 pages.');
}

function parsePage(body: unknown): { count: number; next?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Indexer attestation search returned an unexpected body.');
  }
  const record = body as Record<string, unknown>;
  const transactions = record.transactions;
  if (transactions !== undefined && !Array.isArray(transactions)) {
    throw new Error('Indexer attestation search returned an unexpected body.');
  }
  const next = record['next-token'];
  if (next !== undefined && typeof next !== 'string') {
    throw new Error('Indexer attestation search returned an unexpected body.');
  }
  return {
    count: Array.isArray(transactions) ? transactions.length : 0,
    next: typeof next === 'string' && next.length > 0 ? next : undefined,
  };
}
