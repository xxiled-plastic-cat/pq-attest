import algosdk from "algosdk";
import { bytesToBase32, bytesToHex, hexToBytes } from "../bytes.ts";
import { blockCapabilities } from "../capabilities.ts";
import { algorandBlockHash } from "../hash.ts";
import { asRecord, endpointBases, getBytes, getJson, mapTransport, type FetchLike } from "../http.ts";
import type { AlgorandProof, FetchedBlock } from "../types.ts";
import type { BuiltInclusion } from "../adapter.ts";

// algonode.cloud and nodely.dev sit behind Cloudflare and return 403 to Workers.
const PUBLIC_ALGOD = [
  "https://mainnet-api.algonode.network",
  "https://mainnet-api.4160.nodely.dev",
  "https://mainnet-api.algonode.cloud",
];
const PUBLIC_INDEXER = [
  "https://mainnet-idx.algonode.network",
  "https://mainnet-idx.4160.nodely.dev",
  "https://mainnet-idx.algonode.cloud",
];

export async function fetchAlgorandBlock(
  height: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<FetchedBlock> {
  return mapTransport(endpointBases(env.ALGOD_URL, PUBLIC_ALGOD), (algod) =>
    fetchAlgorandBlockFrom(algod, height, fetchImpl, env),
  );
}

async function fetchAlgorandBlockFrom(
  algod: string,
  height: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<FetchedBlock> {
  const round = height;
  const encoded = await getBytes(
    `${algod}/v2/blocks/${round}?format=msgpack`,
    fetchImpl,
    nodeInit(env, "application/msgpack", "ALGOD_TOKEN"),
  );
  const decoded = algosdk.msgpackRawDecodeAsMap(encoded);
  if (!(decoded instanceof Map)) {
    throw new Error("Algorand block msgpack was not a map.");
  }
  const block = decoded.get("block");
  if (!(block instanceof Map)) {
    throw new Error("Algorand block payload was not a map.");
  }
  const header = new Map(block);
  const txns = block.get("txns");
  const txCount = Array.isArray(txns) ? txns.length : txns instanceof Map ? txns.size : 0;
  header.delete("txns");
  const rawHeader = algosdk.msgpackRawEncode(header);
  const blockHash = algorandBlockHash(rawHeader);
  const reported = asRecord(
    await getJson(`${algod}/v2/blocks/${round}/hash`, fetchImpl, nodeInit(env, "application/json", "ALGOD_TOKEN")),
    "block hash",
  );
  if (String(reported.blockHash) !== blockHash) {
    throw new Error(`Recomputed Algorand block hash ${blockHash} does not match the node.`);
  }
  const txn = bytesField(header.get("txn"));
  const txn256 = header.has("txn256") ? bytesToHex(bytesField(header.get("txn256"))) : undefined;
  const prev = header.get("prev");
  const capabilities = blockCapabilities("algorand");
  return {
    height: String(header.get("rnd")),
    blockHash,
    parentHash: prev instanceof Uint8Array && prev.length > 0 ? bytesToBase32(prev) : "",
    txRoot: bytesToHex(txn),
    txRootType: capabilities.txRootType,
    txCount,
    blockTime: header.get("ts") == null ? null : new Date(Number(header.get("ts")) * 1000).toISOString(),
    rawHeader,
    hashMode: "recomputed",
    headerHash: "algo-bh",
    ...(txn256 ? { commitments: { txn256 } } : {}),
  };
}

export async function proveAlgorandTransaction(
  height: string,
  txId: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<BuiltInclusion> {
  return mapTransport(endpointBases(env.ALGOD_URL, PUBLIC_ALGOD), async (algod) => {
    const body = asRecord(
      await getJson(
        `${algod}/v2/blocks/${height}/transactions/${txId}/proof?hashtype=sha512_256`,
        fetchImpl,
        nodeInit(env, "application/json", "ALGOD_TOKEN"),
      ),
      "Algorand proof",
    );
    const proofBytes = Buffer.from(String(body.proof ?? ""), "base64");
    const stib = Buffer.from(String(body.stibhash ?? ""), "base64");
    const proof: AlgorandProof = {
      type: "algo-sha512_256",
      index: Number(body.idx),
      treeDepth: Number(body.treedepth),
      hashType: "sha512_256",
      stibHashHex: bytesToHex(stib),
      siblingsHex: bytesToHex(proofBytes),
    };
    return {
      proof,
      leaf: {
        type: "algo-sha512_256",
        description: "SHA-512/256 of TL || transaction id || signed-transaction-in-block hash.",
      },
    };
  });
}

export async function algorandTransactionHeight(txId: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<string> {
  return mapTransport(endpointBases(env.INDEXER_URL, PUBLIC_INDEXER), async (indexer) => {
    const body = asRecord(
      await getJson(`${indexer}/v2/transactions/${txId}`, fetchImpl, nodeInit(env, "application/json", "INDEXER_TOKEN")),
      "indexer transaction",
    );
    const transaction = asRecord(body.transaction, "transaction");
    const round = transaction["confirmed-round"];
    if (round == null) {
      throw new Error(`Transaction ${txId} is not confirmed on Algorand.`);
    }
    return String(round);
  });
}

function nodeInit(env: NodeJS.ProcessEnv, accept: string, tokenKey: "ALGOD_TOKEN" | "INDEXER_TOKEN"): RequestInit {
  const headers: Record<string, string> = { accept, "user-agent": "pq-attest" };
  const token = env[tokenKey]?.trim();
  if (token) {
    headers[tokenKey === "ALGOD_TOKEN" ? "X-Algo-API-Token" : "X-Indexer-API-Token"] = token;
  }
  return { headers };
}

function bytesField(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "string") {
    return hexToBytes(value);
  }
  return new Uint8Array(32);
}
