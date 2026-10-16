export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function getJson(url: string, fetchImpl: FetchLike, init?: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} from ${url}`);
  }
  return response.json() as Promise<unknown>;
}

export async function getBytes(url: string, fetchImpl: FetchLike, init?: RequestInit): Promise<Uint8Array> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} from ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function postJson(url: string, body: unknown, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} from ${url}`);
  }
  return response.json() as Promise<unknown>;
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function envUrl(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const configured = env[key]?.trim();
  return (configured && configured.length > 0 ? configured : fallback).replace(/\/$/, "");
}

/** Public hosts fail over to each other. A private URL stays put so tests and private nodes do not leak. */
export function endpointBases(configured: string | undefined, publics: readonly string[]): string[] {
  const normalize = (value: string) => value.trim().replace(/\/$/, "");
  const known = new Set(publics.map(normalize));
  const first = normalize(configured && configured.trim() ? configured : publics[0]!);
  if (!known.has(first)) {
    return [first];
  }
  return [first, ...publics.map(normalize).filter((item) => item !== first)];
}

export async function mapTransport<T>(bases: readonly string[], run: (base: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const base of bases) {
    try {
      return await run(base);
    } catch (error) {
      last = error;
      if (!isTransportError(error)) {
        throw error;
      }
    }
  }
  if (last instanceof Error) {
    throw last;
  }
  throw new Error("The block request failed.");
}

function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "TypeError" || /^\d{3} from /.test(error.message);
}
