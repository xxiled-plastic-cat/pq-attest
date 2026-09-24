import { hashTransaction } from "./canonical.ts";

export const BASE_CHAIN_ID = 8453;
export const ETHEREUM_CHAIN_ID = 1;
export const POLYGON_CHAIN_ID = 137;
export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
export const DEFAULT_ETHEREUM_RPC_URL = "https://ethereum.publicnode.com";
export const DEFAULT_POLYGON_RPC_URL = "https://polygon-bor.publicnode.com";
const MAX_CANONICAL_BYTES = 1_000_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type EvmSourceChain = "base" | "ethereum" | "polygon";

const EVM_CHAIN: Record<EvmSourceChain, { chainId: number; label: string; envKey: string; defaultUrl: string }> = {
  base: { chainId: BASE_CHAIN_ID, label: "Base", envKey: "BASE_RPC_URL", defaultUrl: DEFAULT_BASE_RPC_URL },
  ethereum: { chainId: ETHEREUM_CHAIN_ID, label: "Ethereum", envKey: "ETH_RPC_URL", defaultUrl: DEFAULT_ETHEREUM_RPC_URL },
  polygon: { chainId: POLYGON_CHAIN_ID, label: "Polygon", envKey: "POLYGON_RPC_URL", defaultUrl: DEFAULT_POLYGON_RPC_URL },
};

export interface BaseLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
}

export interface BaseSourceDocument {
  chainId: number;
  hash: string;
  blockNumber: string;
  blockHash: string;
  transactionIndex: string;
  from: string;
  to: string | null;
  value: string;
  input: string;
  nonce: string;
  gas: string;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  type: string;
  status: string;
  gasUsed: string;
  cumulativeGasUsed: string;
  contractAddress: string | null;
  logs: BaseLog[];
}

export function baseRpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  return evmRpcUrl("base", env);
}

export function evmRpcUrl(chain: EvmSourceChain, env: NodeJS.ProcessEnv = process.env): string {
  const spec = EVM_CHAIN[chain];
  const configured = env[spec.envKey]?.trim();
  return configured ? configured : spec.defaultUrl;
}

export async function fetchBaseTransaction(
  txid: string,
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BaseSourceDocument> {
  return fetchEvmTransaction("base", txid, fetchImpl, env);
}

export async function fetchEvmTransaction(
  chain: EvmSourceChain,
  txid: string,
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BaseSourceDocument> {
  const spec = EVM_CHAIN[chain];
  const hash = txid.toLowerCase();
  const url = evmRpcUrl(chain, env);
  const [transaction, receipt] = await Promise.all([
    rpcCall(url, "eth_getTransactionByHash", [hash], fetchImpl, hash, spec.label),
    rpcCall(url, "eth_getTransactionReceipt", [hash], fetchImpl, hash, spec.label),
  ]);
  if (transaction == null) {
    throw new Error(`${spec.label} did not return transaction ${hash}.`);
  }
  if (receipt == null) {
    throw new Error(`Transaction ${hash} is not confirmed on ${spec.label}.`);
  }
  return canonicalEvmDocument(spec.chainId, spec.label, hash, transaction, receipt);
}

export function canonicalBaseDocument(txid: string, transaction: unknown, receipt: unknown): BaseSourceDocument {
  return canonicalEvmDocument(BASE_CHAIN_ID, "Base", txid, transaction, receipt);
}

export function canonicalEvmDocument(
  chainId: number,
  label: string,
  txid: string,
  transaction: unknown,
  receipt: unknown,
): BaseSourceDocument {
  const tx = record(transaction, "transaction");
  const rec = record(receipt, "receipt");
  const hash = normalizeHash(tx.hash, "transaction.hash");
  if (hash !== txid.toLowerCase()) {
    throw new Error(`${label} returned ${hash} for requested txid ${txid.toLowerCase()}.`);
  }
  const receiptHash = normalizeHash(rec.transactionHash, "receipt.transactionHash");
  if (receiptHash !== hash) {
    throw new Error(`${label} receipt hash ${receiptHash} does not match transaction ${hash}.`);
  }
  if (tx.blockNumber == null || rec.blockNumber == null) {
    throw new Error(`Transaction ${hash} is not confirmed on ${label}.`);
  }
  const blockNumber = normalizeQuantity(tx.blockNumber, "transaction.blockNumber");
  const receiptBlock = normalizeQuantity(rec.blockNumber, "receipt.blockNumber");
  if (receiptBlock !== blockNumber) {
    throw new Error(`${label} receipt block does not match transaction ${hash}.`);
  }
  const document: BaseSourceDocument = {
    chainId,
    hash,
    blockNumber,
    blockHash: normalizeHash(tx.blockHash, "transaction.blockHash"),
    transactionIndex: normalizeQuantity(tx.transactionIndex, "transaction.transactionIndex"),
    from: requiredAddress(tx.from, "transaction.from"),
    to: normalizeAddress(tx.to, "transaction.to"),
    value: normalizeQuantity(tx.value, "transaction.value"),
    input: normalizeData(tx.input, "transaction.input"),
    nonce: normalizeQuantity(tx.nonce, "transaction.nonce"),
    gas: normalizeQuantity(tx.gas, "transaction.gas"),
    gasPrice: optionalQuantity(tx.gasPrice, "transaction.gasPrice"),
    maxFeePerGas: optionalQuantity(tx.maxFeePerGas, "transaction.maxFeePerGas"),
    maxPriorityFeePerGas: optionalQuantity(tx.maxPriorityFeePerGas, "transaction.maxPriorityFeePerGas"),
    type: normalizeQuantity(tx.type ?? "0x0", "transaction.type"),
    status: normalizeQuantity(rec.status, "receipt.status"),
    gasUsed: normalizeQuantity(rec.gasUsed, "receipt.gasUsed"),
    cumulativeGasUsed: normalizeQuantity(rec.cumulativeGasUsed, "receipt.cumulativeGasUsed"),
    contractAddress: normalizeAddress(rec.contractAddress, "receipt.contractAddress"),
    logs: normalizeLogs(rec.logs),
  };
  return document;
}

export function hashBaseDocument(document: BaseSourceDocument) {
  return hashEvmDocument(document, "Base");
}

export function hashEvmDocument(document: BaseSourceDocument, label = "EVM") {
  const hashed = hashTransaction(document);
  if (hashed.txnBytes.byteLength > MAX_CANONICAL_BYTES) {
    throw new Error(
      `Canonical ${label} document is ${hashed.txnBytes.byteLength} bytes; the maximum is ${MAX_CANONICAL_BYTES}.`,
    );
  }
  return hashed;
}

async function rpcCall(
  url: string,
  method: string,
  params: string[],
  fetchImpl: FetchLike,
  txid: string,
  label: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: response was not JSON.`);
  }
  if (!body || typeof body !== "object") {
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: response was not JSON.`);
  }
  const error = (body as { error?: { message?: unknown } }).error;
  if (error) {
    const message = typeof error.message === "string" ? error.message : method;
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: ${message}`);
  }
  return (body as { result?: unknown }).result ?? null;
}

function normalizeLogs(value: unknown): BaseLog[] {
  if (!Array.isArray(value)) {
    throw new Error("EVM receipt.logs must be an array.");
  }
  return value.map((entry, index) => {
    const log = record(entry, `receipt.logs[${index}]`);
    const topics = log.topics;
    if (!Array.isArray(topics)) {
      throw new Error(`EVM receipt.logs[${index}].topics must be an array.`);
    }
    return {
      address: requiredAddress(log.address, `receipt.logs[${index}].address`),
      topics: topics.map((topic, topicIndex) => normalizeHash(topic, `receipt.logs[${index}].topics[${topicIndex}]`)),
      data: normalizeData(log.data, `receipt.logs[${index}].data`),
      logIndex: normalizeQuantity(log.logIndex, `receipt.logs[${index}].logIndex`),
    };
  });
}

function optionalQuantity(value: unknown, field: string): string | null {
  if (value == null) {
    return null;
  }
  return normalizeQuantity(value, field);
}

function normalizeQuantity(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`EVM ${field} must be a hex quantity.`);
  }
  return `0x${BigInt(value).toString(16)}`;
}

function normalizeHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`EVM ${field} must be a 32-byte hex hash.`);
  }
  return value.toLowerCase();
}

function normalizeData(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`EVM ${field} must be hex data.`);
  }
  return value.toLowerCase();
}

function normalizeAddress(value: unknown, field: string): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`EVM ${field} must be an address.`);
  }
  return value.toLowerCase();
}

function requiredAddress(value: unknown, field: string): string {
  const address = normalizeAddress(value, field);
  if (!address) {
    throw new Error(`EVM ${field} must be an address.`);
  }
  return address;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`EVM ${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}
