import { bytesToHex, concatBytes, equalBytes, hexToBytes, utf8 } from "./bytes.ts";
import { sha256Bytes, sha512_256Bytes } from "./hash.ts";
import { base32ToBytes } from "./bytes.ts";

export interface AlgorandInclusionProof {
  index: number;
  treeDepth: number;
  hashType: "sha512_256" | "sha256";
  stibHashHex: string;
  siblingsHex: string;
}

const LEAF_PREFIX = utf8("TL");
const NODE_PREFIX = utf8("MA");

export function verifyAlgorandInclusion(
  txRootHex: string,
  txid: string,
  proof: AlgorandInclusionProof,
): { ok: boolean; reason: string } {
  try {
    if (proof.hashType !== "sha512_256" && proof.hashType !== "sha256") {
      return { ok: false, reason: `Unsupported Algorand hash type ${proof.hashType}.` };
    }
    const hash = proof.hashType === "sha256" ? sha256Bytes : sha512_256Bytes;
    const txidBytes = base32ToBytes(txid);
    if (txidBytes.length !== 32) {
      return { ok: false, reason: "The Algorand transaction id is not a 32-byte hash." };
    }
    const stib = hexToBytes(proof.stibHashHex);
    if (stib.length !== 32) {
      return { ok: false, reason: "The signed-transaction-in-block hash is not 32 bytes." };
    }
    let current = hash(concatBytes([LEAF_PREFIX, txidBytes, stib]));
    const siblings = hexToBytes(proof.siblingsHex);
    if (siblings.length !== proof.treeDepth * 32) {
      return { ok: false, reason: "The Algorand proof length does not match its tree depth." };
    }
    let position = proof.index;
    for (let level = 0; level < proof.treeDepth; level += 1) {
      const sibling = siblings.subarray(level * 32, (level + 1) * 32);
      const left = (position & 1) === 0 ? current : sibling;
      const right = (position & 1) === 0 ? sibling : current;
      current = hash(concatBytes([NODE_PREFIX, left, right]));
      position >>= 1;
    }
    if (!equalBytes(current, hexToBytes(txRootHex))) {
      return { ok: false, reason: "The Algorand proof does not reach the block's txn commitment." };
    }
    return { ok: true, reason: "The transaction is in the Algorand payset Merkle tree." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The Algorand proof could not be checked." };
  }
}

export function bytesToPrefixedHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}
