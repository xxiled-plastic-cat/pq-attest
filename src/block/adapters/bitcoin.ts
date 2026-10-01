import { bytesToHex, hexToBytes } from "../bytes.ts";
import { bitcoinHeaderHash, bitcoinMerkleProof, merkleRoot } from "../bitcoin.ts";
import { equalBytes } from "../bytes.ts";
import { asRecord, envUrl, getJson, type FetchLike } from "../http.ts";
import type { BitcoinProof, FetchedBlock } from "../types.ts";
import type { BuiltInclusion } from "../adapter.ts";

const DEFAULT_API = "https://mempool.space/api";

export async function fetchBitcoinBlock(
  height: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<FetchedBlock> {
  const root = envUrl(env, "BITCOIN_API_URL", DEFAULT_API);
  const hash = await text(`${root}/block-height/${height}`, fetchImpl);
  const headerHex = await text(`${root}/block/${hash}/header`, fetchImpl);
  const header = hexToBytes(headerHex.trim());
  const computed = bitcoinHeaderHash(header);
  if (computed !== hash.toLowerCase()) {
    throw new Error(`Recomputed Bitcoin header hash ${computed} does not match ${hash}.`);
  }
  const info = asRecord(await getJson(`${root}/block/${hash}`, fetchImpl), "bitcoin block");
  const txids = (await getJson(`${root}/block/${hash}/txids`, fetchImpl)) as unknown;
  if (!Array.isArray(txids) || txids.some((txid) => typeof txid !== "string")) {
    throw new Error("Bitcoin did not return a transaction id list.");
  }
  const rootBytes = header.subarray(36, 68);
  const rebuilt = merkleRoot(txids);
  if (txids.length > 0 && !equalBytes(rebuilt, rootBytes)) {
    throw new Error("Rebuilt Bitcoin merkle root does not match the header.");
  }
  return {
    height: String(info.height),
    blockHash: computed,
    parentHash: bytesToHex(reverse(header.subarray(4, 36))),
    txRoot: bytesToHex(rootBytes),
    txRootType: "btc-dsha256",
    txCount: txids.length,
    blockTime: info.timestamp == null ? null : new Date(Number(info.timestamp) * 1000).toISOString(),
    rawHeader: header,
    hashMode: "recomputed",
    headerHash: "btc-dsha256",
  };
}

export async function proveBitcoinTransaction(
  height: string,
  txId: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<BuiltInclusion> {
  const root = envUrl(env, "BITCOIN_API_URL", DEFAULT_API);
  const hash = await text(`${root}/block-height/${height}`, fetchImpl);
  const txids = (await getJson(`${root}/block/${hash}/txids`, fetchImpl)) as string[];
  const branch = bitcoinMerkleProof(txids, txId);
  const proof: BitcoinProof = { type: "btc-dsha256", index: branch.index, siblings: branch.siblings };
  return {
    proof,
    leaf: { type: "txid", description: "Display transaction id, reversed into the internal Merkle leaf." },
  };
}

export async function bitcoinTransactionHeight(txId: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<string> {
  const root = envUrl(env, "BITCOIN_API_URL", DEFAULT_API);
  const body = asRecord(await getJson(`${root}/tx/${txId}`, fetchImpl), "bitcoin transaction");
  const status = asRecord(body.status, "bitcoin status");
  if (status.confirmed !== true || status.block_height == null) {
    throw new Error(`Transaction ${txId} is not confirmed on Bitcoin.`);
  }
  return String(status.block_height);
}

async function text(url: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${response.status} from ${url}`);
  }
  return (await response.text()).trim();
}

function reverse(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes).reverse();
}
