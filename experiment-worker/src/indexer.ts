import type { ChainClients } from "./chain.js";
import { ATTESTOR_ADDRESS, blockNotePrefix, type ExperimentChain } from "./constants.js";
import type { ExistingAttest } from "./run.js";

type AttestIndexer = ChainClients["indexer"];

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
  indexer: AttestIndexer;
  height: number;
}): Promise<ExistingAttest | null> {
  return findBlockAttest({ ...options, chain: "bitcoin" });
}

export async function findBlockAttest(options: {
  indexer: AttestIndexer;
  chain: ExperimentChain;
  height: number;
}): Promise<ExistingAttest | null> {
  const notePrefix = bytesToBase64(new TextEncoder().encode(blockNotePrefix(options.height, options.chain)));
  let page: unknown;
  try {
    page = await options.indexer.searchForTransactions({
      address: ATTESTOR_ADDRESS,
      addressRole: "sender",
      notePrefix,
      limit: 10,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error.";
    throw new Error(`Indexer attestation search failed: ${message}`);
  }
  return existingAttestFromPage(page, options.height, options.chain);
}

function readTransaction(value: unknown, prefix: string): ExistingAttest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as { id?: unknown; note?: unknown };
  if (typeof record.id !== "string") {
    return null;
  }
  const note = noteText(record.note);
  if (note === null) {
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

function noteText(note: unknown): string | null {
  if (note instanceof Uint8Array) {
    return new TextDecoder().decode(note);
  }
  if (typeof note !== "string") {
    return null;
  }
  try {
    return new TextDecoder().decode(base64ToBytes(note));
  } catch {
    return null;
  }
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
