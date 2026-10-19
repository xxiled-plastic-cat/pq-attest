import { ATTESTOR_ADDRESS, blockNotePrefix, type ExperimentChain } from "./constants.js";
import type { ExistingAttest } from "./run.js";

export function existingAttestFromPage(
  body: unknown,
  height: number,
  chain: ExperimentChain = "bitcoin",
): ExistingAttest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Indexer returned an unexpected body.");
  }
  const transactions = (body as { transactions?: unknown }).transactions;
  if (transactions === undefined) {
    return null;
  }
  if (!Array.isArray(transactions)) {
    throw new Error("Indexer returned an unexpected body.");
  }
  const prefix = blockNotePrefix(height, chain);
  for (const txn of transactions) {
    const found = readTransaction(txn, prefix);
    if (found) {
      return found;
    }
  }
  return null;
}

export async function findBitcoinBlockAttest(options: {
  indexerUrl: string;
  height: number;
  fetchImpl: typeof fetch;
}): Promise<ExistingAttest | null> {
  return findBlockAttest({ ...options, chain: "bitcoin" });
}

export async function findBlockAttest(options: {
  indexerUrl: string;
  chain: ExperimentChain;
  height: number;
  fetchImpl: typeof fetch;
}): Promise<ExistingAttest | null> {
  const fetchImpl = options.fetchImpl;
  const base = options.indexerUrl.endsWith("/") ? options.indexerUrl : `${options.indexerUrl}/`;
  const url = new URL("v2/transactions", base);
  url.searchParams.set("address", ATTESTOR_ADDRESS);
  url.searchParams.set("address-role", "sender");
  url.searchParams.set(
    "note-prefix",
    bytesToBase64(new TextEncoder().encode(blockNotePrefix(options.height, options.chain))),
  );
  url.searchParams.set("limit", "10");

  let response: Response;
  try {
    // Call fetch as a free function. options.fetchImpl() would set `this` to the options object,
    // which Workers rejects as an illegal invocation.
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error.";
    throw new Error(`Indexer attestation search failed: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`Indexer attestation search failed (${response.status}).`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Indexer returned an unexpected body.");
  }
  return existingAttestFromPage(body, options.height, options.chain);
}

function readTransaction(value: unknown, prefix: string): ExistingAttest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as { id?: unknown; note?: unknown };
  if (typeof record.id !== "string" || typeof record.note !== "string") {
    return null;
  }
  let note: string;
  try {
    note = new TextDecoder().decode(base64ToBytes(record.note));
  } catch {
    return null;
  }
  if (!note.startsWith(prefix)) {
    return null;
  }
  const blockHash = note.slice(prefix.length).toLowerCase();
  if (!/^(?:0x)?[0-9a-f]+$/.test(blockHash)) {
    return null;
  }
  return { txnId: record.id, blockHash };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
