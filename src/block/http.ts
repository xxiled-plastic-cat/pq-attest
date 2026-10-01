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
