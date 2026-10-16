import { bytesToHex, equalBytes, hexToBytes, reverseBytes } from "../bytes.ts";
import { bitcoinHeaderHash, bitcoinMerkleProof } from "../bitcoin.ts";
import { asRecord, endpointBases, getJson, mapTransport, type FetchLike } from "../http.ts";
import type { BitcoinProof, FetchedBlock } from "../types.ts";
import type { BuiltInclusion } from "../adapter.ts";

const PUBLIC_BITCOIN = ["https://mempool.space/api", "https://blockstream.info/api"];

export async function fetchBitcoinBlock(
  height: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<FetchedBlock> {
  return mapTransport(endpointBases(env.BITCOIN_API_URL, PUBLIC_BITCOIN), (root) =>
    fetchBitcoinBlockFrom(root, height, fetchImpl),
  );
}

async function fetchBitcoinBlockFrom(root: string, height: string, fetchImpl: FetchLike): Promise<FetchedBlock> {
  const hash = await text(`${root}/block-height/${height}`, fetchImpl);
  const headerHex = await text(`${root}/block/${hash}/header`, fetchImpl);
  const header = hexToBytes(headerHex.trim());
  const computed = bitcoinHeaderHash(header);
  if (computed !== hash.toLowerCase()) {
    throw new Error(`Recomputed Bitcoin header hash ${computed} does not match ${hash}.`);
  }
  const info = asRecord(await getJson(`${root}/block/${hash}`, fetchImpl, BITCOIN_INIT), "bitcoin block");
  const rootBytes = header.subarray(36, 68);
  if (typeof info.merkle_root !== "string" || info.merkle_root.length === 0) {
    throw new Error("Bitcoin did not return a merkle root.");
  }
  const reportedRoot = reverseBytes(hexToBytes(info.merkle_root));
  if (!equalBytes(reportedRoot, rootBytes)) {
    throw new Error("Bitcoin merkle root does not match the header.");
  }
  const txCount = typeof info.tx_count === "number" ? info.tx_count : Number(info.tx_count);
  if (!Number.isSafeInteger(txCount) || txCount < 0) {
    throw new Error("Bitcoin did not return a transaction count.");
  }
  return {
    height: String(info.height),
    blockHash: computed,
    parentHash: bytesToHex(reverseBytes(header.subarray(4, 36))),
    txRoot: bytesToHex(rootBytes),
    txRootType: "btc-dsha256",
    txCount,
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
  return mapTransport(endpointBases(env.BITCOIN_API_URL, PUBLIC_BITCOIN), async (root) => {
    const hash = await text(`${root}/block-height/${height}`, fetchImpl);
    const txids = (await getJson(`${root}/block/${hash}/txids`, fetchImpl, BITCOIN_INIT)) as string[];
    const branch = bitcoinMerkleProof(txids, txId);
    const proof: BitcoinProof = { type: "btc-dsha256", index: branch.index, siblings: branch.siblings };
    return {
      proof,
      leaf: { type: "txid", description: "Display transaction id, reversed into the internal Merkle leaf." },
    };
  });
}

export async function bitcoinTransactionHeight(txId: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<string> {
  return mapTransport(endpointBases(env.BITCOIN_API_URL, PUBLIC_BITCOIN), async (root) => {
    const body = asRecord(await getJson(`${root}/tx/${txId}`, fetchImpl, BITCOIN_INIT), "bitcoin transaction");
    const status = asRecord(body.status, "bitcoin status");
    if (status.confirmed !== true || status.block_height == null) {
      throw new Error(`Transaction ${txId} is not confirmed on Bitcoin.`);
    }
    return String(status.block_height);
  });
}

const BITCOIN_INIT: RequestInit = { headers: { accept: "application/json", "user-agent": "pq-attest" } };

async function text(url: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchImpl(url, { headers: { "user-agent": "pq-attest" } });
  if (!response.ok) {
    throw new Error(`${response.status} from ${url}`);
  }
  return (await response.text()).trim();
}
