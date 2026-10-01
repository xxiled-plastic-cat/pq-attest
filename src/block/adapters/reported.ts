import { asRecord, envUrl, getJson, postJson, type FetchLike } from "../http.ts";
import { reportedBlock } from "../record.ts";
import type { FetchedBlock } from "../types.ts";

const APTOS = "https://fullnode.mainnet.aptoslabs.com/v1";
const HEDERA = "https://mainnet-public.mirrornode.hedera.com";
const TON = "https://tonapi.io/v2";

export async function fetchAptosBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock> {
  const root = envUrl(env, "APTOS_API_URL", APTOS);
  const target = height;
  const block = asRecord(await getJson(`${root}/blocks/by_height/${target}`, fetchImpl), "aptos block");
  return reportedBlock("aptos", {
    height: String(block.block_height),
    blockHash: String(block.block_hash),
    parentHash: "",
    txCount: Array.isArray(block.transactions) ? block.transactions.length : 0,
    blockTime: block.block_timestamp == null ? null : new Date(Number(block.block_timestamp) / 1000).toISOString(),
  });
}

const SUI_GRAPHQL = "https://graphql.mainnet.sui.io/graphql";

export async function fetchSuiBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock> {
  const configured = env.SUI_RPC_URL?.trim();
  if (configured && !configured.includes("graphql")) {
    try {
      return await fetchSuiJsonRpc(configured, height, fetchImpl);
    } catch {
      // Public JSON-RPC fullnodes no longer serve checkpoint reads.
    }
  }
  const endpoint = envUrl(env, "SUI_GRAPHQL_URL", SUI_GRAPHQL);
  const query = `{ checkpoint(id: { sequenceNumber: ${Number(height)} }) { sequenceNumber digest previousCheckpointDigest timestamp } }`;
  const body = asRecord(await postJson(endpoint, { query }, fetchImpl), "sui graphql");
  if (body.errors) {
    throw new Error("Sui did not return a checkpoint.");
  }
  const data = asRecord(body.data, "sui data");
  const checkpoint = asRecord(data.checkpoint, "checkpoint");
  return reportedBlock("sui", {
    height: String(checkpoint.sequenceNumber),
    blockHash: String(checkpoint.digest),
    parentHash: String(checkpoint.previousCheckpointDigest ?? ""),
    txCount: 0,
    blockTime: typeof checkpoint.timestamp === "string" ? checkpoint.timestamp : null,
  });
}

async function fetchSuiJsonRpc(url: string, height: string, fetchImpl: FetchLike): Promise<FetchedBlock> {
  const id = height;
  const checkpoint = asRecord(await rpc(url, "sui_getCheckpoint", [String(id)], fetchImpl), "sui checkpoint");
  return reportedBlock("sui", {
    height: String(checkpoint.sequenceNumber),
    blockHash: String(checkpoint.digest),
    parentHash: String(checkpoint.previousDigest ?? ""),
    txCount: Array.isArray(checkpoint.transactions) ? checkpoint.transactions.length : 0,
    blockTime: checkpoint.timestampMs == null ? null : new Date(Number(checkpoint.timestampMs)).toISOString(),
    extra: { contentDigest: checkpoint.contentDigest ?? null },
  });
}

export async function fetchHederaBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock> {
  const root = envUrl(env, "HEDERA_API_URL", HEDERA);
  const path = `/api/v1/blocks/${height}`;
  const body = asRecord(await getJson(`${root}${path}`, fetchImpl), "hedera blocks");
  const block = Array.isArray(body.blocks) ? asRecord(body.blocks[0], "hedera block") : body;
  return reportedBlock("hedera", {
    height: String(block.number),
    blockHash: String(block.hash),
    parentHash: String(block.previous_hash ?? ""),
    txCount: Number(block.count ?? 0),
    blockTime: hederaTime(block.timestamp),
  });
}

export async function fetchTonBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock> {
  const root = envUrl(env, "TON_API_URL", TON);
  const seqno = Number(height);
  const block = asRecord(
    await getJson(`${root}/blockchain/blocks/(-1,8000000000000000,${seqno})`, fetchImpl),
    "ton block",
  );
  const previousRef = Array.isArray(block.prev_refs) ? String(block.prev_refs[0] ?? "") : "";
  let parentHash = previousRef;
  if (previousRef.startsWith("(")) {
    const previous = asRecord(await getJson(`${root}/blockchain/blocks/${previousRef}`, fetchImpl), "ton parent");
    parentHash = String(previous.root_hash ?? previousRef);
  }
  return reportedBlock("ton", {
    height: String(block.seqno ?? seqno),
    blockHash: String(block.root_hash),
    parentHash,
    txCount: Number(block.tx_quantity ?? 0),
    blockTime: block.gen_utime == null ? null : new Date(Number(block.gen_utime) * 1000).toISOString(),
    extra: { workchain: -1, shard: String(block.shard ?? "8000000000000000"), fileHash: block.file_hash ?? null },
  });
}

function hederaTime(timestamp: unknown): string | null {
  if (typeof timestamp === "string") {
    return timestamp;
  }
  if (timestamp && typeof timestamp === "object" && "from" in timestamp) {
    const from = (timestamp as { from?: unknown }).from;
    return typeof from === "string" ? from : null;
  }
  return null;
}

async function rpc(url: string, method: string, params: unknown[], fetchImpl: FetchLike): Promise<unknown> {
  const body = asRecord(await postJson(url, { jsonrpc: "2.0", id: 1, method, params }, fetchImpl), method);
  if (body.error) {
    throw new Error(String(asRecord(body.error, "rpc error").message ?? `${method} failed.`));
  }
  return body.result;
}
