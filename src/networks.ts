import { hashTransaction } from "./canonical.ts";
import type { SourceChain } from "./source.ts";

const MAX_CANONICAL_BYTES = 1_000_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
export const DEFAULT_BITCOIN_API_URL = "https://mempool.space/api";
export const DEFAULT_APTOS_API_URL = "https://fullnode.mainnet.aptoslabs.com/v1";
export const DEFAULT_SUI_RPC_URL = "https://fullnode.mainnet.sui.io";
export const DEFAULT_HEDERA_API_URL = "https://mainnet-public.mirrornode.hedera.com";
export const DEFAULT_STELLAR_API_URL = "https://horizon.stellar.org";
export const DEFAULT_NEAR_API_URL = "https://api.nearblocks.io/v1";
export const DEFAULT_TON_API_URL = "https://tonapi.io/v2";

export function hashSourceDocument(label: string, document: unknown) {
  const hashed = hashTransaction(document);
  if (hashed.txnBytes.byteLength > MAX_CANONICAL_BYTES) {
    throw new Error(
      `Canonical ${label} document is ${hashed.txnBytes.byteLength} bytes; the maximum is ${MAX_CANONICAL_BYTES}.`,
    );
  }
  return hashed;
}

export function sourceDocumentId(chain: SourceChain, document: unknown): string | undefined {
  if (!document || typeof document !== "object") {
    return undefined;
  }
  const record = document as Record<string, unknown>;
  switch (chain) {
    case "algorand":
      return typeof record.id === "string" ? record.id : undefined;
    case "base":
    case "ethereum":
    case "polygon":
    case "aptos":
    case "stellar":
      return typeof record.hash === "string" ? record.hash : undefined;
    case "solana":
      return typeof record.signature === "string" ? record.signature : undefined;
    case "bitcoin":
      return typeof record.txid === "string" ? record.txid : undefined;
    case "sui":
      return typeof record.digest === "string" ? record.digest : undefined;
    case "near":
    case "ton":
    case "hedera":
      return typeof record.id === "string" ? record.id : undefined;
  }
}

function endpoint(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const configured = env[key]?.trim();
  return (configured ? configured : fallback).replace(/\/$/, "");
}

async function getJson(url: string, label: string, txid: string, fetchImpl: FetchLike): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: ${message}`);
  }
  if (response.status === 404) {
    throw new Error(`${label} did not return transaction ${txid}.`);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: response was not JSON.`);
  }
}

async function rpc(
  url: string,
  method: string,
  params: unknown[],
  label: string,
  txid: string,
  fetchImpl: FetchLike,
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
  const body = (await response.json()) as { error?: { message?: unknown }; result?: unknown };
  if (body.error) {
    const message = typeof body.error.message === "string" ? body.error.message : method;
    throw new Error(`Failed to fetch transaction ${txid} from ${label}: ${message}`);
  }
  return body.result ?? null;
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export async function fetchSolanaTransaction(txid: string, fetchImpl: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env) {
  const url = endpoint(env, "SOLANA_RPC_URL", DEFAULT_SOLANA_RPC_URL);
  const result = await rpc(
    url,
    "getTransaction",
    [txid, { commitment: "finalized", maxSupportedTransactionVersion: 0, encoding: "json" }],
    "Solana",
    txid,
    fetchImpl,
  );
  if (result == null) {
    throw new Error(`Solana did not return transaction ${txid}.`);
  }
  return canonicalSolanaDocument(txid, result);
}

export function canonicalSolanaDocument(txid: string, value: unknown) {
  const body = objectOf(value, "Solana transaction");
  const meta = objectOf(body.meta ?? {}, "Solana meta");
  const transaction = objectOf(body.transaction, "Solana transaction");
  const signatures = transaction.signatures;
  const signature = Array.isArray(signatures) ? signatures[0] : undefined;
  if (signature !== txid) {
    throw new Error(`Solana returned ${String(signature)} for requested txid ${txid}.`);
  }
  if (typeof body.slot !== "number") {
    throw new Error(`Transaction ${txid} is not finalized on Solana.`);
  }
  const message = objectOf(transaction.message, "Solana message");
  const loaded = meta.loadedAddresses;
  return {
    signature: txid,
    slot: body.slot,
    blockTime: typeof body.blockTime === "number" ? body.blockTime : null,
    err: meta.err ?? null,
    fee: typeof meta.fee === "number" ? meta.fee : null,
    preBalances: Array.isArray(meta.preBalances) ? meta.preBalances : [],
    postBalances: Array.isArray(meta.postBalances) ? meta.postBalances : [],
    logMessages: Array.isArray(meta.logMessages) ? meta.logMessages : [],
    instructions: Array.isArray(message.instructions) ? message.instructions : [],
    loadedAddresses: loaded && typeof loaded === "object" ? loaded : null,
  };
}

export async function fetchBitcoinTransaction(txid: string, fetchImpl: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env) {
  const root = endpoint(env, "BITCOIN_API_URL", DEFAULT_BITCOIN_API_URL);
  const [transaction, tip] = await Promise.all([
    getJson(`${root}/tx/${txid}`, "Bitcoin", txid, fetchImpl),
    getJson(`${root}/blocks/tip/height`, "Bitcoin", txid, fetchImpl),
  ]);
  const tipHeight = typeof tip === "number" ? tip : Number(tip);
  if (!Number.isSafeInteger(tipHeight)) {
    throw new Error(`Failed to fetch transaction ${txid} from Bitcoin: tip height was not a number.`);
  }
  return canonicalBitcoinDocument(txid, transaction, tipHeight);
}

export function canonicalBitcoinDocument(txid: string, value: unknown, tipHeight: number) {
  const body = objectOf(value, "Bitcoin transaction");
  if (body.txid !== txid) {
    throw new Error(`Bitcoin returned ${String(body.txid)} for requested txid ${txid}.`);
  }
  const status = objectOf(body.status, "Bitcoin status");
  if (status.confirmed !== true || typeof status.block_height !== "number" || typeof status.block_hash !== "string") {
    throw new Error(`Transaction ${txid} is not confirmed on Bitcoin.`);
  }
  const confirmationCount = tipHeight - status.block_height + 1;
  if (!Number.isSafeInteger(confirmationCount) || confirmationCount < 1) {
    throw new Error(`Transaction ${txid} is not confirmed on Bitcoin.`);
  }
  return {
    txid,
    version: body.version ?? null,
    locktime: body.locktime ?? null,
    inputs: Array.isArray(body.vin) ? body.vin.map(bitcoinInput) : [],
    outputs: Array.isArray(body.vout) ? body.vout.map(bitcoinOutput) : [],
    blockHash: status.block_hash,
    blockHeight: status.block_height,
    confirmationCount,
  };
}

function bitcoinInput(value: unknown) {
  const input = objectOf(value, "Bitcoin input");
  return {
    txid: input.txid ?? null,
    vout: input.vout ?? null,
    scriptsig: input.scriptsig ?? "",
    sequence: input.sequence ?? null,
    witness: Array.isArray(input.witness) ? input.witness : [],
  };
}

function bitcoinOutput(value: unknown) {
  const output = objectOf(value, "Bitcoin output");
  return {
    value: output.value ?? null,
    scriptpubkey: output.scriptpubkey ?? "",
    address: output.scriptpubkey_address ?? null,
  };
}

export async function fetchAptosTransaction(txid: string, fetchImpl: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env) {
  const root = endpoint(env, "APTOS_API_URL", DEFAULT_APTOS_API_URL);
  const body = await getJson(`${root}/transactions/by_hash/${txid}`, "Aptos", txid, fetchImpl);
  return canonicalAptosDocument(txid, body);
}

export function canonicalAptosDocument(txid: string, value: unknown) {
  const body = objectOf(value, "Aptos transaction");
  if (typeof body.hash !== "string" || body.hash.toLowerCase() !== txid.toLowerCase()) {
    throw new Error(`Aptos returned ${String(body.hash)} for requested txid ${txid}.`);
  }
  if (body.version == null || typeof body.success !== "boolean") {
    throw new Error(`Transaction ${txid} is not confirmed on Aptos.`);
  }
  return {
    hash: txid,
    version: String(body.version),
    success: body.success,
    vmStatus: typeof body.vm_status === "string" ? body.vm_status : "",
    gasUsed: body.gas_used == null ? null : String(body.gas_used),
    payload: body.payload ?? null,
    events: Array.isArray(body.events) ? body.events : [],
  };
}

export async function fetchSuiTransaction(txid: string, fetchImpl: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env) {
  const url = endpoint(env, "SUI_RPC_URL", DEFAULT_SUI_RPC_URL);
  const result = await rpc(
    url,
    "sui_getTransactionBlock",
    [txid, { showInput: true, showEffects: true, showEvents: true }],
    "Sui",
    txid,
    fetchImpl,
  );
  if (result == null) {
    throw new Error(`Sui did not return transaction ${txid}.`);
  }
  return canonicalSuiDocument(txid, result);
}

export function canonicalSuiDocument(txid: string, value: unknown) {
  const body = objectOf(value, "Sui transaction");
  if (body.digest !== txid) {
    throw new Error(`Sui returned ${String(body.digest)} for requested txid ${txid}.`);
  }
  if (body.checkpoint == null) {
    throw new Error(`Transaction ${txid} is not confirmed on Sui.`);
  }
  const effects = objectOf(body.effects ?? {}, "Sui effects");
  const status = objectOf(effects.status ?? {}, "Sui status");
  return {
    digest: txid,
    checkpoint: String(body.checkpoint),
    status: typeof status.status === "string" ? status.status : null,
    transaction: body.transaction ?? null,
    events: Array.isArray(body.events) ? body.events : [],
  };
}

export async function fetchHederaTransaction(txid: string, fetchImpl: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env) {
  const root = endpoint(env, "HEDERA_API_URL", DEFAULT_HEDERA_API_URL);
  const body = await getJson(`${root}/api/v1/transactions/${encodeURIComponent(txid)}`, "Hedera", txid, fetchImpl);
  return canonicalHederaDocument(txid, body);
}

export function canonicalHederaDocument(txid: string, value: unknown) {
  const body = objectOf(value, "Hedera response");
  const transactions = body.transactions;
  const first = Array.isArray(transactions) ? transactions[0] : undefined;
  if (!first) {
    throw new Error(`Hedera did not return transaction ${txid}.`);
  }
  const txn = objectOf(first, "Hedera transaction");
  if (txn.transaction_id !== txid) {
    throw new Error(`Hedera returned ${String(txn.transaction_id)} for requested txid ${txid}.`);
  }
  if (typeof txn.consensus_timestamp !== "string") {
    throw new Error(`Transaction ${txid} is not confirmed on Hedera.`);
  }
  return {
    id: txid,
    consensusTimestamp: txn.consensus_timestamp,
    result: typeof txn.result === "string" ? txn.result : null,
    transfers: Array.isArray(txn.transfers) ? txn.transfers : [],
    memo: typeof txn.memo_base64 === "string" ? txn.memo_base64 : null,
  };
}

export async function fetchStellarTransaction(txid: string, fetchImpl: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env) {
  const root = endpoint(env, "STELLAR_API_URL", DEFAULT_STELLAR_API_URL);
  const body = await getJson(`${root}/transactions/${txid}`, "Stellar", txid, fetchImpl);
  return canonicalStellarDocument(txid, body);
}

export function canonicalStellarDocument(txid: string, value: unknown) {
  const body = objectOf(value, "Stellar transaction");
  if (typeof body.hash !== "string" || body.hash.toLowerCase() !== txid) {
    throw new Error(`Stellar returned ${String(body.hash)} for requested txid ${txid}.`);
  }
  if (typeof body.ledger !== "number") {
    throw new Error(`Transaction ${txid} is not confirmed on Stellar.`);
  }
  return {
    hash: txid,
    ledger: body.ledger,
    successful: body.successful === true,
    feeCharged: body.fee_charged == null ? null : String(body.fee_charged),
    operationCount: typeof body.operation_count === "number" ? body.operation_count : null,
    sourceAccount: typeof body.source_account === "string" ? body.source_account : null,
    memoType: typeof body.memo_type === "string" ? body.memo_type : null,
    memo: typeof body.memo === "string" ? body.memo : null,
    envelopeXdr: typeof body.envelope_xdr === "string" ? body.envelope_xdr : "",
  };
}

export async function fetchNearTransaction(txid: string, fetchImpl: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env) {
  const root = endpoint(env, "NEAR_API_URL", DEFAULT_NEAR_API_URL);
  const body = await getJson(`${root}/txns/${txid}`, "NEAR", txid, fetchImpl);
  return canonicalNearDocument(txid, body);
}

export function canonicalNearDocument(txid: string, value: unknown) {
  const body = objectOf(value, "NEAR response");
  const txns = body.txns;
  const first = Array.isArray(txns) ? txns[0] : undefined;
  if (!first) {
    throw new Error(`NEAR did not return transaction ${txid}.`);
  }
  const txn = objectOf(first, "NEAR transaction");
  if (txn.transaction_hash !== txid) {
    throw new Error(`NEAR returned ${String(txn.transaction_hash)} for requested txid ${txid}.`);
  }
  const block = objectOf(txn.block ?? txn.receipt_block ?? {}, "NEAR block");
  if (block.block_height == null) {
    throw new Error(`Transaction ${txid} is not confirmed on NEAR.`);
  }
  const outcomes = txn.outcomes && typeof txn.outcomes === "object" ? txn.outcomes : {};
  const status = (outcomes as { status?: unknown }).status;
  return {
    id: txid,
    signer: typeof txn.signer_account_id === "string" ? txn.signer_account_id : null,
    receiver: typeof txn.receiver_account_id === "string" ? txn.receiver_account_id : null,
    nonce: txn.nonce == null ? null : String(txn.nonce),
    actions: Array.isArray(txn.actions) ? txn.actions : [],
    status: status ?? null,
    blockHeight: String(block.block_height),
  };
}

export async function fetchTonTransaction(txid: string, fetchImpl: FetchLike = fetch, env: NodeJS.ProcessEnv = process.env) {
  const root = endpoint(env, "TON_API_URL", DEFAULT_TON_API_URL);
  const body = await getJson(`${root}/blockchain/transactions/${encodeURIComponent(txid)}`, "TON", txid, fetchImpl);
  return canonicalTonDocument(txid, body);
}

export function canonicalTonDocument(txid: string, value: unknown) {
  const body = objectOf(value, "TON transaction");
  const hash = typeof body.hash === "string" ? body.hash : "";
  if (hash !== txid && hash.toLowerCase() !== txid.toLowerCase()) {
    throw new Error(`TON returned ${hash} for requested txid ${txid}.`);
  }
  const account = objectOf(body.account, "TON account");
  if (typeof account.address !== "string" || body.lt == null) {
    throw new Error(`Transaction ${txid} is not confirmed on TON.`);
  }
  return {
    id: txid,
    account: account.address,
    lt: String(body.lt),
    now: typeof body.now === "number" ? body.now : null,
    outMessages: Array.isArray(body.out_msgs) ? body.out_msgs : [],
    description: body.description ?? null,
  };
}

export async function fetchForeignTransaction(
  chain: Exclude<SourceChain, "algorand" | "base" | "ethereum" | "polygon">,
  txid: string,
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = process.env,
) {
  switch (chain) {
    case "solana":
      return fetchSolanaTransaction(txid, fetchImpl, env);
    case "bitcoin":
      return fetchBitcoinTransaction(txid, fetchImpl, env);
    case "aptos":
      return fetchAptosTransaction(txid, fetchImpl, env);
    case "sui":
      return fetchSuiTransaction(txid, fetchImpl, env);
    case "hedera":
      return fetchHederaTransaction(txid, fetchImpl, env);
    case "stellar":
      return fetchStellarTransaction(txid, fetchImpl, env);
    case "near":
      return fetchNearTransaction(txid, fetchImpl, env);
    case "ton":
      return fetchTonTransaction(txid, fetchImpl, env);
  }
}
