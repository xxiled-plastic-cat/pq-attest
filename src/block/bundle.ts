import { microAlgo, type AlgorandClient } from "@algorandfoundation/algokit-utils";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { accountFromMnemonic, pqKeyPair } from "../pq.ts";
import { isSourceChain, resolveSourceRequest, type SourceChain } from "../source.ts";
import { assertInclusionSupported, adapterFor } from "./adapter.ts";
import "./adapters/index.ts";
import { bytesToBase64 } from "./bytes.ts";
import { blockCapabilities } from "./capabilities.ts";
import type { FetchLike } from "./http.ts";
import type { BlockAnchor, BlockAttestBundle, TxInclusionV1, UnsignedBlockAttest } from "./types.ts";
import { blockAttestMessage, blockAttestNote } from "./verify.ts";

const NOTE_MAX_BYTES = 1024;
const FALCON_MIN_FEE_MICROALGO = 3000;

export interface AttestBlockInput {
  chain: SourceChain;
  height: string;
  blockHash?: string;
  algorand: AlgorandClient;
  mnemonic: string | undefined;
  falconSeed: string | undefined;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  attestedAt?: string;
}

export async function attestBlock(input: AttestBlockInput): Promise<BlockAttestBundle> {
  if (!/^[0-9]+$/.test(input.height)) {
    throw new Error("block number must be an integer.");
  }
  const fetched = await adapterFor(input.chain).fetchBlock(
    input.chain,
    input.height,
    input.fetchImpl ?? fetch,
    input.env ?? process.env,
  );
  if (input.blockHash && input.blockHash.toLowerCase() !== fetched.blockHash.toLowerCase()) {
    throw new Error(`Block ${fetched.height} hash is ${fetched.blockHash}, not ${input.blockHash}.`);
  }
  return signAndAnchor(input, fetched);
}

export async function proveTxInclusion(
  input: AttestBlockInput & { txId: string },
): Promise<TxInclusionV1> {
  assertInclusionSupported(input.chain);
  const adapter = adapterFor(input.chain);
  if (!adapter.proveInclusion) {
    throw new Error(`${input.chain} does not build inclusion proofs.`);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const env = input.env ?? process.env;
  let height = input.height;
  if (!height) {
    if (!adapter.resolveHeight) {
      throw new Error(`${input.chain} needs a block number to find ${input.txId}.`);
    }
    height = await adapter.resolveHeight(input.chain, input.txId, fetchImpl, env);
  }
  if (!/^[0-9]+$/.test(height)) {
    throw new Error("block number must be an integer.");
  }
  const inclusion = await adapter.proveInclusion(input.chain, height, input.txId, fetchImpl, env);
  const bundle = await attestBlock({ ...input, height });
  return {
    schema: "tx-inclusion-v1",
    chainFamily: bundle.chainFamily,
    chain: bundle.chain,
    network: bundle.network,
    height: bundle.height,
    txId: input.txId,
    leaf: inclusion.leaf,
    proof: inclusion.proof,
    blockAttest: bundle,
  };
}

export function parseBlockAttestBody(body: unknown): {
  chain: SourceChain;
  height: string;
  blockHash?: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected a JSON object.");
  }
  const record = body as { chain?: unknown; height?: unknown; toHeight?: unknown; blockHash?: unknown };
  if (!isSourceChain(record.chain)) {
    throw new Error("chain is required.");
  }
  if (record.toHeight != null && record.toHeight !== "") {
    throw new Error("Attest one block at a time.");
  }
  const height = normalizeHeight(record.height, "block number");
  const blockHash = record.blockHash == null || record.blockHash === "" ? undefined : String(record.blockHash);
  return { chain: record.chain, height, ...(blockHash ? { blockHash } : {}) };
}

export function parseProveBody(body: unknown): { chain: SourceChain; txId: string; height: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected a JSON object.");
  }
  const record = body as { chain?: unknown; txId?: unknown; txid?: unknown; height?: unknown };
  const resolved = resolveSourceRequest(record.txId ?? record.txid, record.chain);
  const height = record.height == null || record.height === "" ? "" : normalizeHeight(record.height, "block number");
  return { chain: resolved.chain, txId: resolved.txid, height };
}

function normalizeHeight(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return value.replace(/^0+(?=\d)/, "");
  }
  throw new Error(`${label} must be an integer.`);
}

async function signAndAnchor(
  input: AttestBlockInput,
  fetched: import("./types.ts").FetchedBlock,
): Promise<BlockAttestBundle> {
  const trimmedMnemonic = input.mnemonic?.trim() ?? "";
  accountFromMnemonic(trimmedMnemonic);
  const note = blockAttestNote(input.chain, fetched.height, fetched.blockHash);
  if (Buffer.byteLength(note, "utf8") > NOTE_MAX_BYTES) {
    throw new Error(`Block attest note is ${Buffer.byteLength(note, "utf8")} bytes; the maximum is ${NOTE_MAX_BYTES}.`);
  }
  const submitted = await submitBlockAnchor(input.algorand, input.falconSeed, note);
  const anchor: BlockAnchor = { txnId: submitted.txnId, round: submitted.round, note: submitted.note };
  const keys = pqKeyPair(trimmedMnemonic);
  const capabilities = blockCapabilities(input.chain);
  const unsigned: UnsignedBlockAttest = {
    schema: "block-attest-v1",
    chainFamily: capabilities.chainFamily,
    chain: input.chain,
    network: capabilities.network,
    height: fetched.height,
    blockHash: fetched.blockHash,
    parentHash: fetched.parentHash,
    txRoot: fetched.txRoot,
    txRootType: fetched.txRootType,
    txCount: fetched.txCount,
    timestamp: {
      blockTime: fetched.blockTime,
      attestedAt: input.attestedAt ?? new Date().toISOString(),
    },
    rawHeader: bytesToBase64(fetched.rawHeader),
    hashMode: fetched.hashMode,
    headerHash: fetched.headerHash,
    ...(fetched.commitments ? { commitments: fetched.commitments } : {}),
    anchor,
    attestor: {
      algorandAddress: submitted.sender,
      pqPublicKey: Buffer.from(keys.publicKey).toString("base64"),
    },
  };
  const signature = ml_dsa65.sign(blockAttestMessage(unsigned), keys.secretKey);
  return {
    ...unsigned,
    signature: { alg: "ML-DSA-65", sigBase64: Buffer.from(signature).toString("base64") },
  };
}

async function submitBlockAnchor(
  algorand: AlgorandClient,
  falconSeed: string | undefined,
  note: string,
): Promise<BlockAnchor & { sender: string }> {
  const { falconSigningAccount } = await import("../accounts.ts");
  const falcon = falconSigningAccount(falconSeed);
  const sender = falcon.address.toString();
  algorand.setSigner(sender, falcon.txnSigner);
  const result = await algorand.send.payment({
    sender,
    receiver: sender,
    amount: microAlgo(0),
    note,
    staticFee: microAlgo(FALCON_MIN_FEE_MICROALGO),
    suppressLog: true,
  });
  const txnId = result.txIds[0];
  if (!txnId) {
    throw new Error("Block attest transaction was not submitted.");
  }
  const round = result.confirmation?.confirmedRound;
  if (round == null) {
    throw new Error("Block attest transaction was not confirmed.");
  }
  return { txnId, round: Number(round), note, sender };
}
