import { bytesToHex, concatBytes, equalBytes, hexToBytes, reverseBytes } from "./bytes.ts";
import { bitcoinHashHex, doubleSha256 } from "./hash.ts";

export interface BitcoinMerkleProof {
  index: number;
  txid: string;
  siblings: string[];
}

export function bitcoinHeaderHash(header: Uint8Array): string {
  if (header.length !== 80) {
    throw new Error(`Bitcoin header is ${header.length} bytes; expected 80.`);
  }
  return bitcoinHashHex(header);
}

export function merkleRoot(txidsDisplayHex: string[]): Uint8Array {
  if (txidsDisplayHex.length === 0) {
    return doubleSha256(new Uint8Array());
  }
  let level = txidsDisplayHex.map((txid) => reverseBytes(hexToBytes(txid)));
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(level[level.length - 1]!);
    }
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(doubleSha256(concatBytes([level[i]!, level[i + 1]!])));
    }
    level = next;
  }
  return level[0]!;
}

export function bitcoinMerkleProof(txidsDisplayHex: string[], txid: string): BitcoinMerkleProof {
  const index = txidsDisplayHex.findIndex((candidate) => candidate.toLowerCase() === txid.toLowerCase());
  if (index < 0) {
    throw new Error(`Transaction ${txid} is not in this block.`);
  }
  let level = txidsDisplayHex.map((id) => reverseBytes(hexToBytes(id)));
  let position = index;
  const siblings: string[] = [];
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(level[level.length - 1]!);
    }
    const sibling = position % 2 === 0 ? position + 1 : position - 1;
    siblings.push(bytesToHex(level[sibling]!));
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(doubleSha256(concatBytes([level[i]!, level[i + 1]!])));
    }
    level = next;
    position = Math.floor(position / 2);
  }
  return { index, txid: txid.toLowerCase(), siblings };
}

export function verifyBitcoinMerkle(root: Uint8Array, proof: BitcoinMerkleProof): { ok: boolean; reason: string } {
  try {
    let current = reverseBytes(hexToBytes(proof.txid));
    let position = proof.index;
    for (const siblingHex of proof.siblings) {
      const sibling = hexToBytes(siblingHex);
      const pair = position % 2 === 0 ? [current, sibling] : [sibling, current];
      current = doubleSha256(concatBytes(pair));
      position = Math.floor(position / 2);
    }
    if (position !== 0) {
      return { ok: false, reason: "The Merkle branch is shorter than the transaction index." };
    }
    if (!equalBytes(current, root)) {
      return { ok: false, reason: "The Merkle branch does not reach this block's merkle root." };
    }
    return { ok: true, reason: "The transaction is in the Bitcoin Merkle tree." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The Bitcoin proof could not be checked." };
  }
}
