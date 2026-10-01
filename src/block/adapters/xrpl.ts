import { bytesToHex, concatBytes, equalBytes, hexToBytes } from "../bytes.ts";
import { envUrl, postJson, type FetchLike } from "../http.ts";
import { shamapProof, shamapRoot, xrplLedgerHash, xrplTransactionId } from "../shamap.ts";
import type { FetchedBlock, XrplProof } from "../types.ts";
import type { BuiltInclusion } from "../adapter.ts";

const DEFAULT_API = "https://xrplcluster.com";

async function ledgerRequest(
  height: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const url = envUrl(env, "XRPL_API_URL", DEFAULT_API);
  const ledgerIndex = Number(height);
  const body = (await postJson(
    url,
    {
      method: "ledger",
      params: [{ ledger_index: ledgerIndex, transactions: true, binary: false, expand: false }],
    },
    fetchImpl,
  )) as { result?: { ledger?: Record<string, unknown>; ledger_hash?: string; ledger_index?: number } };
  const ledger = body.result?.ledger;
  if (!ledger) {
    throw new Error(`XRPL did not return ledger ${height}.`);
  }
  if (body.result?.ledger_hash && ledger.ledger_hash == null) {
    ledger.ledger_hash = body.result.ledger_hash;
  }
  if (body.result?.ledger_index != null && ledger.ledger_index == null) {
    ledger.ledger_index = body.result.ledger_index;
  }
  return ledger;
}

export async function fetchXrplBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock> {
  const ledger = await ledgerRequest(height, fetchImpl, env);
  const rawHeader = encodeLedgerHeader(ledger);
  const computed = bytesToHex(xrplLedgerHash(rawHeader));
  const reported = String(ledger.ledger_hash ?? "").toLowerCase();
  if (computed !== reported) {
    throw new Error(`Recomputed XRPL ledger hash ${computed} does not match ${reported}.`);
  }
  const transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
  const closeTime = Number(ledger.close_time ?? 0);
  return {
    height: String(ledger.ledger_index),
    blockHash: computed,
    parentHash: String(ledger.parent_hash ?? "").toLowerCase(),
    txRoot: String(ledger.transaction_hash ?? "").toLowerCase(),
    txRootType: "none",
    txCount: transactions.length,
    blockTime: closeTime > 0 ? new Date((closeTime + 946684800) * 1000).toISOString() : null,
    rawHeader,
    hashMode: "recomputed",
    headerHash: "xrpl-lwr",
  };
}

export async function proveXrplTransaction(
  height: string,
  txId: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<BuiltInclusion> {
  const ledger = await ledgerRequest(height, fetchImpl, env);
  const items = transactionItems(ledger);
  const key = hexToBytes(txId);
  const found = items.find((item) => equalBytes(item.key, key));
  if (!found) {
    throw new Error(`Transaction ${txId} is not in XRPL ledger ${height}.`);
  }
  const branch = shamapProof(items, key);
  const proof: XrplProof = {
    type: "xrpl-shamap",
    keyHex: branch.keyHex,
    leafHex: branch.leafHex,
    txHex: bytesToHex(found.serialized),
    levels: branch.levels,
  };
  return {
    proof,
    leaf: { type: "xrpl-txn", description: "SHA-512 half of the TXN prefix and the serialized transaction." },
  };
}

export async function xrplTransactionHeight(txId: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<string> {
  const url = envUrl(env, "XRPL_API_URL", DEFAULT_API);
  const body = (await postJson(url, { method: "tx", params: [{ transaction: txId, binary: false }] }, fetchImpl)) as {
    result?: { ledger_index?: number; validated?: boolean };
  };
  if (!body.result?.validated || body.result.ledger_index == null) {
    throw new Error(`Transaction ${txId} is not in a validated XRPL ledger.`);
  }
  return String(body.result.ledger_index);
}

function blockFromLedger(ledger: Record<string, unknown>): FetchedBlock {
  const rawHeader = encodeLedgerHeader(ledger);
  const computed = bytesToHex(xrplLedgerHash(rawHeader));
  const reported = String(ledger.ledger_hash ?? "").toLowerCase();
  if (computed !== reported) {
    throw new Error(`Recomputed XRPL ledger hash ${computed} does not match ${reported}.`);
  }
  const items = transactionItems(ledger);
  const rebuilt = bytesToHex(shamapRoot(items));
  const txRoot = String(ledger.transaction_hash ?? "").toLowerCase();
  if (rebuilt !== txRoot) {
    throw new Error(`Rebuilt XRPL SHAMap root ${rebuilt} does not match ${txRoot}.`);
  }
  const closeTime = Number(ledger.close_time ?? 0);
  return {
    height: String(ledger.ledger_index),
    blockHash: computed,
    parentHash: String(ledger.parent_hash ?? "").toLowerCase(),
    txRoot,
    txRootType: "xrpl-shamap",
    txCount: items.length,
    blockTime: closeTime > 0 ? new Date((closeTime + 946684800) * 1000).toISOString() : null,
    rawHeader,
    hashMode: "recomputed",
    headerHash: "xrpl-lwr",
  };
}

function transactionItems(ledger: Record<string, unknown>): Array<{ key: Uint8Array; hash: Uint8Array; serialized: Uint8Array }> {
  const transactions = ledger.transactions;
  if (!Array.isArray(transactions)) {
    return [];
  }
  return transactions.map((entry) => {
    const serialized = hexToBytes(transactionHex(entry));
    const hash = xrplTransactionId(serialized);
    return { key: hash, hash, serialized };
  });
}

function transactionHex(entry: unknown): string {
  if (typeof entry === "string") {
    return entry;
  }
  if (entry && typeof entry === "object" && "tx_blob" in entry && typeof entry.tx_blob === "string") {
    return entry.tx_blob;
  }
  throw new Error("XRPL ledger transaction was not a binary blob.");
}

function encodeLedgerHeader(ledger: Record<string, unknown>): Uint8Array {
  return concatBytes([
    u32(Number(ledger.ledger_index)),
    u64(BigInt(String(ledger.total_coins ?? "0"))),
    hexToBytes(String(ledger.parent_hash)),
    hexToBytes(String(ledger.transaction_hash)),
    hexToBytes(String(ledger.account_hash)),
    u32(Number(ledger.parent_close_time ?? 0)),
    u32(Number(ledger.close_time ?? 0)),
    new Uint8Array([Number(ledger.close_time_resolution ?? 0), Number(ledger.close_flags ?? 0)]),
  ]);
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value);
  return out;
}
