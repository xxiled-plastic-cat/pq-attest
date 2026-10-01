import { evmRpcUrl, type EvmSourceChain } from "../../base.ts";
import { canonicalJson } from "../../canonical.ts";
import { hexToBytes } from "../bytes.ts";
import { blockCapabilities } from "../capabilities.ts";
import { encodeEvmHeader, evmHeaderHash, type EvmHeaderStyle } from "../evm-header.ts";
import { asRecord, postJson, type FetchLike } from "../http.ts";
import { emptyTrieRootHex, transactionTrie } from "../mpt.ts";
import type { EvmProof, FetchedBlock } from "../types.ts";

const MAX_TRANSACTIONS = 10_000;

export async function fetchEvmBlock(
  chain: EvmSourceChain,
  height: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<FetchedBlock> {
  const url = await workingEvmUrl(chain, fetchImpl, env);
  const block = asRecord(await rpc(url, "eth_getBlockByNumber", [hexQuantity(height), false], fetchImpl), "block");
  if (block.hash == null) {
    throw new Error(`${chain} did not return block ${height}.`);
  }
  let encoded: Uint8Array;
  let hashMode: FetchedBlock["hashMode"] = "recomputed";
  let headerHash: FetchedBlock["headerHash"] = "evm-keccak";
  try {
    encoded = encodeMatchingHeader(block);
  } catch (error) {
    if (chain !== "avalanche") {
      throw error;
    }
    const record = {
      blockHash: String(block.hash).toLowerCase(),
      parentHash: String(block.parentHash).toLowerCase(),
      transactionsRoot: String(block.transactionsRoot).toLowerCase(),
      number: quantityNumber(block.number).toString(),
      note: "The Coreth header encoding did not recompute to the node hash.",
    };
    encoded = new TextEncoder().encode(canonicalJson(record));
    hashMode = "reported";
    headerHash = "reported";
  }
  const capabilities = blockCapabilities(chain);
  const txCount = Array.isArray(block.transactions) ? block.transactions.length : quantityNumber(block.transactions);
  return {
    height: quantityNumber(block.number).toString(),
    blockHash: String(block.hash).toLowerCase(),
    parentHash: String(block.parentHash).toLowerCase(),
    txRoot: String(block.transactionsRoot).toLowerCase(),
    txRootType: capabilities.txRootType,
    txCount,
    blockTime: block.timestamp == null ? null : new Date(quantityNumber(block.timestamp) * 1000).toISOString(),
    rawHeader: encoded,
    hashMode,
    headerHash,
  };
}

export async function proveEvmTransaction(
  chain: EvmSourceChain,
  height: string,
  txId: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<{ proof: EvmProof; index: number }> {
  const url = await workingEvmUrl(chain, fetchImpl, env);
  const block = asRecord(
    await rpc(url, "eth_getBlockByNumber", [hexQuantity(height), true], fetchImpl),
    "block",
  );
  const transactions = Array.isArray(block.transactions) ? block.transactions : [];
  if (transactions.length > MAX_TRANSACTIONS) {
    throw new Error(`Block ${height} has ${transactions.length} transactions, above the ${MAX_TRANSACTIONS} proof limit.`);
  }
  const hashes = transactions.map((tx) => {
    const record = asRecord(tx, "transaction");
    return String(record.hash).toLowerCase();
  });
  const index = hashes.indexOf(txId.toLowerCase());
  if (index < 0) {
    throw new Error(`Transaction ${txId} is not in ${chain} block ${height}.`);
  }
  const raw = await rawTransactions(url, hashes, fetchImpl);
  const trie = transactionTrie(raw);
  const expected = String(block.transactionsRoot).toLowerCase();
  if (transactions.length === 0) {
    if (expected !== emptyTrieRootHex()) {
      throw new Error("The empty block's transaction root is not the empty trie root.");
    }
  } else if (trie.rootHex !== expected) {
    throw new Error(`Rebuilt transaction trie ${trie.rootHex} does not match ${expected}.`);
  }
  const proof = trie.prove(index);
  return { index, proof: { type: "evm-mpt-keccak", ...proof } };
}

export async function evmTransactionHeight(
  chain: EvmSourceChain,
  txId: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const url = await workingEvmUrl(chain, fetchImpl, env);
  const tx = await rpc(url, "eth_getTransactionByHash", [txId.toLowerCase()], fetchImpl);
  if (tx == null) {
    throw new Error(`${chain} did not return transaction ${txId}.`);
  }
  const record = asRecord(tx, "transaction");
  if (record.blockNumber == null) {
    throw new Error(`Transaction ${txId} is not in a block on ${chain}.`);
  }
  return quantityNumber(record.blockNumber).toString();
}

function encodeMatchingHeader(block: Record<string, unknown>): Uint8Array {
  const expected = String(block.hash).toLowerCase();
  const styles: EvmHeaderStyle[] = ["standard", "arbitrum", "avalanche"];
  const mismatches: string[] = [];
  for (const style of styles) {
    try {
      const encoded = encodeEvmHeader(block, style);
      if (evmHeaderHash(block, style) === expected) {
        return encoded;
      }
      mismatches.push(`${style} ${evmHeaderHash(block, style)}`);
    } catch (error) {
      mismatches.push(`${style} ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  throw new Error(`Header hash does not match the node (${mismatches.join("; ")}).`);
}

async function rawTransactions(url: string, hashes: string[], fetchImpl: FetchLike): Promise<Uint8Array[]> {
  const raw: Uint8Array[] = [];
  const batchSize = 40;
  for (let offset = 0; offset < hashes.length; offset += batchSize) {
    const slice = hashes.slice(offset, offset + batchSize);
    const body = slice.map((hash, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "eth_getRawTransactionByHash",
      params: [hash],
    }));
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Raw transaction batch failed with ${response.status}.`);
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      for (const hash of slice) {
        const single = asRecord(
          await postJson(url, { jsonrpc: "2.0", id: 1, method: "eth_getRawTransactionByHash", params: [hash] }, fetchImpl),
          "raw transaction",
        );
        if (single.error || typeof single.result !== "string") {
          throw new Error("The node does not serve eth_getRawTransactionByHash, which the transaction trie needs.");
        }
        raw.push(hexToBytes(single.result));
      }
      continue;
    }
    const byId = new Map<number, string>();
    for (const entry of payload) {
      const record = asRecord(entry, "raw transaction");
      if (record.error) {
        throw new Error("The node does not serve eth_getRawTransactionByHash, which the transaction trie needs.");
      }
      byId.set(Number(record.id), String(record.result));
    }
    for (let index = 0; index < slice.length; index += 1) {
      const hex = byId.get(index);
      if (!hex) {
        throw new Error(`Missing raw transaction ${slice[index]}.`);
      }
      raw.push(hexToBytes(hex));
    }
  }
  return raw;
}

const POLYGON_FALLBACKS = ["https://1rpc.io/matic", "https://polygon.drpc.org"];

async function workingEvmUrl(chain: EvmSourceChain, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<string> {
  const urls = [evmRpcUrl(chain, env)];
  if (chain === "polygon") {
    for (const fallback of POLYGON_FALLBACKS) {
      if (!urls.includes(fallback)) {
        urls.push(fallback);
      }
    }
  }
  let last: Error | undefined;
  for (const url of urls) {
    try {
      await rpc(url, "eth_chainId", [], fetchImpl);
      return url;
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw last ?? new Error(`No ${chain} RPC responded.`);
}

async function rpc(url: string, method: string, params: unknown[], fetchImpl: FetchLike): Promise<unknown> {
  const payload = asRecord(await postJson(url, { jsonrpc: "2.0", id: 1, method, params }, fetchImpl), method);
  if (payload.error) {
    const message = asRecord(payload.error, "rpc error");
    throw new Error(String(message.message ?? `${method} failed.`));
  }
  return payload.result;
}

function hexQuantity(height: string): string {
  return `0x${BigInt(height).toString(16)}`;
}

function quantityNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(BigInt(value)) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Block field ${String(value)} is not a safe integer.`);
  }
  return parsed;
}
