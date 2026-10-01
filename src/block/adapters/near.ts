import { base58ToBytes, bytesToHex, utf8 } from "../bytes.ts";
import { canonicalJson } from "../../canonical.ts";
import { sha256Bytes } from "../hash.ts";
import { asRecord, envUrl, getJson, postJson, type FetchLike } from "../http.ts";
import { nearMerkleProof, nearTxRoot } from "../near-merkle.ts";
import { reportedBlock } from "../record.ts";
import type { FetchedBlock, NearProof } from "../types.ts";
import type { BuiltInclusion } from "../adapter.ts";

const DEFAULT_RPC = "https://rpc.mainnet.near.org";
const DEFAULT_INDEX = "https://api.nearblocks.io/v1";

export async function fetchNearBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock> {
  const block = await nearBlock(height, fetchImpl, env);
  return fetchedFromNear(block);
}

export async function proveNearTransaction(
  height: string,
  txId: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<BuiltInclusion> {
  const url = envUrl(env, "NEAR_RPC_URL", DEFAULT_RPC);
  const block = await nearBlock(height, fetchImpl, env);
  const chunks = Array.isArray(block.chunks) ? block.chunks : [];
  for (const entry of chunks) {
    const chunk = asRecord(entry, "chunk");
    const chunkHash = String(chunk.chunk_hash ?? "");
    if (!chunkHash) {
      continue;
    }
    const detail = asRecord(await rpc(url, "chunk", { chunk_id: chunkHash }, fetchImpl), "chunk");
    const transactions = Array.isArray(detail.transactions) ? detail.transactions : [];
    const hashes = transactions.map((tx) => hashHex(transactionHash(tx))).filter((hash) => hash.length === 64);
    const wanted = hashHex(txId);
    if (!hashes.some((hash) => hash === wanted)) {
      continue;
    }
    const chunkTxRoot = hashHex(String(chunk.tx_root));
    if (nearTxRoot(hashes) !== chunkTxRoot) {
      throw new Error(`Rebuilt NEAR chunk root does not match shard ${String(chunk.shard_id)}.`);
    }
    const branch = nearMerkleProof(hashes, wanted);
    const proof: NearProof = {
      type: "near-chunk",
      shardId: String(chunk.shard_id),
      chunkTxRoot: hashHex(String(chunk.tx_root)),
      index: branch.index,
      txHash: wanted,
      siblings: branch.siblings,
    };
    return {
      proof,
      leaf: { type: "near-tx-hash", description: "The transaction hash is the Merkle leaf. Odd nodes are promoted." },
    };
  }
  throw new Error(`Transaction ${txId} is not in a chunk of NEAR block ${height}.`);
}

export async function nearTransactionHeight(txId: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<string> {
  const root = envUrl(env, "NEAR_API_URL", DEFAULT_INDEX);
  const body = asRecord(await getJson(`${root}/txns/${txId}`, fetchImpl), "near transaction");
  const first = Array.isArray(body.txns) ? body.txns[0] : undefined;
  const txn = asRecord(first, "near transaction");
  const block = asRecord(txn.block ?? txn.receipt_block ?? {}, "near block");
  if (block.block_height == null) {
    throw new Error(`Transaction ${txId} is not confirmed on NEAR.`);
  }
  return String(block.block_height);
}

function fetchedFromNear(block: Record<string, unknown>): FetchedBlock {
  const header = asRecord(block.header, "near header");
  const chunks = (Array.isArray(block.chunks) ? block.chunks : []).map((entry) => {
    const chunk = asRecord(entry, "chunk");
    return { shardId: String(chunk.shard_id), txRoot: hashHex(String(chunk.tx_root)) };
  });
  const txRoot = bytesToHex(sha256Bytes(utf8(canonicalJson(chunks))));
  const timestamp = header.timestamp_nanosec ?? header.timestamp;
  return reportedBlock("near", {
    height: String(header.height),
    blockHash: String(header.hash),
    parentHash: String(header.prev_hash ?? ""),
    txCount: 0,
    blockTime: timestamp == null ? null : new Date(Number(BigInt(String(timestamp)) / 1_000_000n)).toISOString(),
    txRoot,
    extra: { chunks },
  });
}

async function nearBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const url = envUrl(env, "NEAR_RPC_URL", DEFAULT_RPC);
  const params = { block_id: Number(height) };
  return asRecord(await rpc(url, "block", params, fetchImpl), "near block");
}

function hashHex(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return bytesToHex(base58ToBytes(trimmed));
}

function transactionHash(entry: unknown): string {
  const record = asRecord(entry, "transaction");
  if (typeof record.hash === "string") {
    return record.hash;
  }
  const nested = asRecord(record.transaction ?? {}, "transaction");
  if (typeof nested.hash === "string") {
    return nested.hash;
  }
  const outcome = asRecord(record.transaction_outcome ?? {}, "outcome");
  return String(outcome.id ?? "");
}

async function rpc(url: string, method: string, params: unknown, fetchImpl: FetchLike): Promise<unknown> {
  const body = asRecord(await postJson(url, { jsonrpc: "2.0", id: 1, method, params }, fetchImpl), method);
  if (body.error) {
    const error = asRecord(body.error, "near error");
    throw new Error(String(error.message ?? error.cause ?? `${method} failed.`));
  }
  return body.result;
}
