import type { NfStatsDocument } from './document.ts';

const BACKOFF_MS = [1000, 2000, 4000] as const;
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class StatsUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatsUploadError';
  }
}

export async function uploadStats(
  document: NfStatsDocument,
  options: {
    env: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const url = options.env.NF_STATS_URL?.trim() ?? '';
  const token = options.env.NF_STATS_TOKEN?.trim() ?? '';
  if (!url) {
    throw new StatsUploadError('NF_STATS_URL is required.');
  }
  if (!token) {
    throw new StatsUploadError('NF_STATS_TOKEN is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new StatsUploadError('NF_STATS_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new StatsUploadError('NF_STATS_URL is not a valid URL.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? delay;
  const body = JSON.stringify(document);
  let lastFailure = 'Stats upload failed.';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(parsed, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body,
      });
    } catch (error) {
      lastFailure = `Stats upload failed: ${scrub(error instanceof Error ? error.message : 'Network error.', token)}`;
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new StatsUploadError(lastFailure);
    }

    const responseBody = scrub(await readBody(response), token);
    if (response.status === 200 && responseBody.trim() === 'ok') {
      return;
    }
    if (response.status >= 500) {
      lastFailure = `Stats upload failed (${response.status}): ${responseBody}`;
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new StatsUploadError(lastFailure);
    }
    throw new StatsUploadError(`Stats upload rejected (${response.status}): ${responseBody}`);
  }

  throw new StatsUploadError(lastFailure);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function scrub(text: string, token: string): string {
  if (!token) {
    return text;
  }
  return text.split(token).join('[redacted]');
}
