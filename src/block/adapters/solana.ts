import { asRecord, envUrl, postJson, type FetchLike } from "../http.ts";
import { reportedBlock } from "../record.ts";
import type { FetchedBlock } from "../types.ts";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export async function fetchSolanaBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock> {
  const url = envUrl(env, "SOLANA_RPC_URL", DEFAULT_RPC);
  const slot = Number(height);
  const block = await getBlock(url, slot, fetchImpl);
  const blockhash = String(block.blockhash);
  return reportedBlock("solana", {
    height: String(slot),
    blockHash: blockhash,
    parentHash: String(block.previousBlockhash ?? ""),
    txCount: 0,
    blockTime: block.blockTime == null ? null : new Date(Number(block.blockTime) * 1000).toISOString(),
    extra: {
      slot,
      parentSlot: block.parentSlot ?? null,
      blockHeight: block.blockHeight ?? null,
    },
  });
}

async function getBlock(url: string, slot: number, fetchImpl: FetchLike): Promise<Record<string, unknown>> {
  const block = await rpc(url, "getBlock", [slot, blockConfig()], fetchImpl);
  if (!block || typeof block !== "object") {
    throw new Error(`Solana slot ${slot} has no block.`);
  }
  return asRecord(block, "solana block");
}

function blockConfig() {
  return {
    commitment: "finalized",
    transactionDetails: "none",
    rewards: false,
    maxSupportedTransactionVersion: 0,
  };
}

async function rpc(url: string, method: string, params: unknown[], fetchImpl: FetchLike): Promise<unknown> {
  const body = asRecord(await postJson(url, { jsonrpc: "2.0", id: 1, method, params }, fetchImpl), method);
  if (body.error) {
    const error = asRecord(body.error, "solana error");
    if (error.code === -32007 || error.code === -32009) {
      return null;
    }
    throw new Error(String(error.message ?? `${method} failed.`));
  }
  return body.result ?? null;
}
