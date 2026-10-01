import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { canonicalJson } from "../canonical.ts";
import { bytesToHex, equalBytes, hexToBytes, base64ToBytes } from "./bytes.ts";
import { verifyAlgorandInclusion } from "./algorand-proof.ts";
import { verifyBitcoinMerkle } from "./bitcoin.ts";
import { algorandBlockHash, bitcoinHashHex, evmHashHex, sha256Bytes } from "./hash.ts";
import { verifyEvmInclusion } from "./mpt.ts";
import { verifyNearChunk } from "./near-merkle.ts";
import { verifyShamap, xrplLedgerHash, xrplTransactionId } from "./shamap.ts";
import type {
  BlockAttestBundle,
  CheckResult,
  TxInclusionV1,
  UnsignedBlockAttest,
  VerifyReport,
} from "./types.ts";

export function unsignedBlockAttest(bundle: BlockAttestBundle): UnsignedBlockAttest {
  return {
    schema: bundle.schema,
    chainFamily: bundle.chainFamily,
    chain: bundle.chain,
    network: bundle.network,
    height: bundle.height,
    blockHash: bundle.blockHash,
    parentHash: bundle.parentHash,
    txRoot: bundle.txRoot,
    txRootType: bundle.txRootType,
    txCount: bundle.txCount,
    timestamp: bundle.timestamp,
    rawHeader: bundle.rawHeader,
    hashMode: bundle.hashMode,
    headerHash: bundle.headerHash,
    ...(bundle.commitments ? { commitments: bundle.commitments } : {}),
    anchor: bundle.anchor,
    attestor: bundle.attestor,
  };
}

export function blockAttestMessage(bundle: UnsignedBlockAttest): Uint8Array {
  return new Uint8Array(Buffer.from(canonicalJson(bundle), "utf8"));
}

export function verifyBlockOffline(bundle: unknown): VerifyReport {
  const checks: CheckResult[] = [];
  const shape = checkShape(bundle);
  checks.push(shape);
  if (!shape.ok || !isBlockBundle(bundle)) {
    return { ok: false, checks };
  }
  checks.push(checkSignature(bundle));
  checks.push(checkNote(bundle));
  checks.push(checkHeaderHash(bundle));
  checks.push(checkTxRoot(bundle));
  return { ok: checks.every((check) => check.ok), checks };
}

export function verifyInclusionOffline(proof: unknown): VerifyReport {
  const checks: CheckResult[] = [];
  if (!isInclusion(proof)) {
    checks.push({ name: "shape", ok: false, reason: "The inclusion proof is not a tx-inclusion-v1 object." });
    return { ok: false, checks };
  }
  checks.push({ name: "shape", ok: true, reason: "The inclusion proof has the tx-inclusion-v1 fields." });
  const blockReport = verifyBlockOffline(proof.blockAttest);
  for (const check of blockReport.checks) {
    checks.push({ name: `block.${check.name}`, ok: check.ok, reason: check.reason });
  }
  if (proof.chain !== proof.blockAttest.chain || proof.network !== proof.blockAttest.network || proof.height !== proof.blockAttest.height) {
    checks.push({
      name: "binding",
      ok: false,
      reason: "The inclusion proof names a different chain, network, or height than the block attestation.",
    });
  } else {
    checks.push({
      name: "binding",
      ok: true,
      reason: "The inclusion proof is bound to this block attestation.",
    });
  }
  if (proof.proof.type !== proof.blockAttest.txRootType) {
    checks.push({
      name: "hashType",
      ok: false,
      reason: `The proof uses ${proof.proof.type}, but the block commits with ${proof.blockAttest.txRootType}.`,
    });
  } else {
    checks.push({ name: "hashType", ok: true, reason: "The proof hash type matches the block's transaction root." });
  }
  checks.push(checkInclusion(proof));
  return { ok: checks.every((check) => check.ok), checks };
}

export function recomputeHeaderHash(bundle: UnsignedBlockAttest): string {
  const raw = base64ToBytes(bundle.rawHeader);
  switch (bundle.headerHash) {
    case "evm-keccak":
      return evmHashHex(raw);
    case "algo-bh":
      return algorandBlockHash(raw);
    case "btc-dsha256":
      return bitcoinHashHex(raw);
    case "xrpl-lwr":
      return bytesToHex(xrplLedgerHash(raw));
    case "stellar-xdr":
      return bytesToHex(sha256Bytes(raw));
    case "reported":
      return bundle.blockHash;
  }
}

function checkHeaderHash(bundle: BlockAttestBundle): CheckResult {
  if (bundle.hashMode === "reported") {
    const record = reportedRecord(bundle);
    if (!record) {
      return {
        name: "headerHash",
        ok: false,
        reason: "The reported block record is not canonical JSON.",
      };
    }
    const embedded = typeof record.blockHash === "string" ? record.blockHash : "";
    if (embedded !== bundle.blockHash) {
      return {
        name: "headerHash",
        ok: false,
        reason: "The block record's blockHash does not match the bundle.",
      };
    }
    return {
      name: "headerHash",
      ok: true,
      reason: "This chain does not expose a header preimage, so the bundle records the node-reported block hash.",
    };
  }
  let computed = "";
  try {
    computed = recomputeHeaderHash(bundle);
  } catch (error) {
    return {
      name: "headerHash",
      ok: false,
      reason: error instanceof Error ? error.message : "The header could not be hashed.",
    };
  }
  if (!sameHash(computed, bundle.blockHash)) {
    return {
      name: "headerHash",
      ok: false,
      reason: `Recomputing the header produced ${computed}, not ${bundle.blockHash}.`,
    };
  }
  return { name: "headerHash", ok: true, reason: "The raw header hashes to the attested block hash." };
}

function checkTxRoot(bundle: BlockAttestBundle): CheckResult {
  if (bundle.txRootType === "none") {
    return { name: "txRoot", ok: true, reason: "This chain has no transaction root in the attested header." };
  }
  if (!bundle.txRoot) {
    return { name: "txRoot", ok: false, reason: "The bundle is missing its transaction root." };
  }
  return { name: "txRoot", ok: true, reason: "The bundle carries a transaction root." };
}

function checkInclusion(proof: TxInclusionV1): CheckResult {
  const root = proof.blockAttest.txRoot;
  switch (proof.proof.type) {
    case "evm-mpt-keccak":
      return named("inclusion", verifyEvmInclusion(root, proof.proof));
    case "algo-sha512_256":
      return named("inclusion", verifyAlgorandInclusion(root, proof.txId, proof.proof));
    case "btc-dsha256": {
      const rootBytes = hexToBytes(root);
      return named("inclusion", verifyBitcoinMerkle(rootBytes, { ...proof.proof, txid: proof.txId }));
    }
    case "xrpl-shamap": {
      const txHash = xrplTransactionId(hexToBytes(proof.proof.txHex));
      if (!equalBytes(txHash, hexToBytes(proof.proof.leafHex))) {
        return {
          name: "inclusion",
          ok: false,
          reason: "The serialized transaction does not hash to the SHAMap leaf.",
        };
      }
      return named("inclusion", verifyShamap(hexToBytes(root), proof.proof));
    }
    case "near-chunk":
      return named("inclusion", verifyNearChunk(proof.blockAttest.rawHeader, root, proof.proof));
    default:
      return { name: "inclusion", ok: false, reason: "This proof type is not supported." };
  }
}

function named(name: string, result: { ok: boolean; reason: string }): CheckResult {
  return { name, ok: result.ok, reason: result.reason };
}

function checkSignature(bundle: BlockAttestBundle): CheckResult {
  try {
    const message = blockAttestMessage(unsignedBlockAttest(bundle));
    const signature = Buffer.from(bundle.signature.sigBase64, "base64");
    const publicKey = Buffer.from(bundle.attestor.pqPublicKey, "base64");
    const ok = ml_dsa65.verify(signature, message, publicKey);
    return ok
      ? { name: "signature", ok: true, reason: "The ML-DSA-65 signature matches the canonical bundle." }
      : { name: "signature", ok: false, reason: "The ML-DSA-65 signature was rejected." };
  } catch (error) {
    return { name: "signature", ok: false, reason: error instanceof Error ? error.message : "The signature could not be checked." };
  }
}

export function blockAttestNote(chain: string, height: string, blockHash: string): string {
  return `block-attest:v1:${chain}:${height}:${blockHash}`;
}

function checkNote(bundle: BlockAttestBundle): CheckResult {
  const expected = blockAttestNote(bundle.chain, bundle.height, bundle.blockHash);
  if (bundle.anchor.note !== expected) {
    return { name: "note", ok: false, reason: "The anchor note does not match the block-attest recipe." };
  }
  return { name: "note", ok: true, reason: "The anchor note matches this chain, height, and block hash." };
}

function checkShape(bundle: unknown): CheckResult {
  if (!isBlockBundle(bundle)) {
    return { name: "shape", ok: false, reason: "The bundle is not a block-attest-v1 object." };
  }
  return { name: "shape", ok: true, reason: "The bundle has the block-attest-v1 fields." };
}

function reportedRecord(bundle: BlockAttestBundle): { blockHash?: unknown } | null {
  try {
    const text = Buffer.from(bundle.rawHeader, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(text);
    if (canonicalJson(parsed) !== text) {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as { blockHash?: unknown };
  } catch {
    return null;
  }
}

function sameHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isBlockBundle(value: unknown): value is BlockAttestBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const bundle = value as Partial<BlockAttestBundle>;
  return (
    bundle.schema === "block-attest-v1" &&
    typeof bundle.chain === "string" &&
    typeof bundle.network === "string" &&
    typeof bundle.height === "string" &&
    typeof bundle.blockHash === "string" &&
    typeof bundle.parentHash === "string" &&
    typeof bundle.txRoot === "string" &&
    typeof bundle.txRootType === "string" &&
    typeof bundle.txCount === "number" &&
    typeof bundle.rawHeader === "string" &&
    (bundle.hashMode === "recomputed" || bundle.hashMode === "reported") &&
    typeof bundle.headerHash === "string" &&
    typeof bundle.anchor?.note === "string" &&
    typeof bundle.anchor?.txnId === "string" &&
    typeof bundle.attestor?.pqPublicKey === "string" &&
    bundle.signature?.alg === "ML-DSA-65" &&
    typeof bundle.signature.sigBase64 === "string"
  );
}

function isInclusion(value: unknown): value is TxInclusionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proof = value as Partial<TxInclusionV1>;
  return proof.schema === "tx-inclusion-v1" && typeof proof.txId === "string" && !!proof.proof && !!proof.blockAttest;
}
