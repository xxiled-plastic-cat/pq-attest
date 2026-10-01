import { base64ToBytes, bytesToHex, concatBytes, equalBytes, hexToBytes, utf8 } from "./bytes.ts";
import { canonicalJson } from "../canonical.ts";
import { sha256Bytes } from "./hash.ts";
import type { NearProof } from "./types.ts";

export interface NearSibling {
  hash: string;
  direction: "left" | "right";
}

export function nearTxRoot(txHashes: string[]): string {
  if (txHashes.length === 0) {
    return "0".repeat(64);
  }
  let level = txHashes.map((hash) => hexToBytes(hash));
  let width = txHashes.length;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    const pairs = Math.ceil(width / 2);
    for (let i = 0; i < pairs; i += 1) {
      const left = level[2 * i];
      const right = level[2 * i + 1];
      if (!left) {
        break;
      }
      next.push(right ? sha256Bytes(concatBytes([left, right])) : left);
    }
    width = Math.ceil(width / 2);
    level = next;
  }
  return bytesToHex(level[0]!);
}

export function nearMerkleProof(txHashes: string[], txHash: string): { index: number; siblings: NearSibling[] } {
  const index = txHashes.findIndex((hash) => hash.toLowerCase() === txHash.toLowerCase());
  if (index < 0) {
    throw new Error(`Transaction ${txHash} is not in this chunk.`);
  }
  const siblings: NearSibling[] = [];
  let level = txHashes.map((hash) => hexToBytes(hash));
  let position = index;
  let width = txHashes.length;
  while (level.length > 1) {
    if (position % 2 === 0) {
      const right = level[position + 1];
      if (right && position + 1 < width) {
        siblings.push({ hash: bytesToHex(right), direction: "right" });
      }
    } else {
      siblings.push({ hash: bytesToHex(level[position - 1]!), direction: "left" });
    }
    const next: Uint8Array[] = [];
    const pairs = Math.ceil(width / 2);
    for (let i = 0; i < pairs; i += 1) {
      const left = level[2 * i];
      const right = level[2 * i + 1];
      if (!left) {
        break;
      }
      next.push(right && 2 * i + 1 < width ? sha256Bytes(concatBytes([left, right])) : left);
    }
    position = Math.floor(position / 2);
    width = Math.ceil(width / 2);
    level = next;
  }
  return { index, siblings };
}

export function verifyNearChunk(
  rawHeader: string,
  blockTxRoot: string,
  proof: NearProof,
): { ok: boolean; reason: string } {
  try {
    const text = Buffer.from(base64ToBytes(rawHeader)).toString("utf8");
    const parsed: unknown = JSON.parse(text);
    if (canonicalJson(parsed) !== text || !parsed || typeof parsed !== "object") {
      return { ok: false, reason: "The NEAR block record is not canonical JSON." };
    }
    const chunks = (parsed as { chunks?: unknown }).chunks;
    if (!Array.isArray(chunks)) {
      return { ok: false, reason: "The NEAR block record has no chunk list." };
    }
    const chunk = chunks.find((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const record = entry as { shardId?: unknown; txRoot?: unknown };
      return record.shardId === proof.shardId && record.txRoot === proof.chunkTxRoot;
    });
    if (!chunk) {
      return { ok: false, reason: "This shard transaction root is not in the attested block record." };
    }
    const commitment = bytesToHex(sha256Bytes(utf8(canonicalJson(chunks))));
    if (blockTxRoot !== commitment) {
      return { ok: false, reason: "The block's transaction commitment does not match the chunk list in the header." };
    }
    let current = hexToBytes(proof.txHash);
    for (const sibling of proof.siblings) {
      const other = hexToBytes(sibling.hash);
      current =
        sibling.direction === "right"
          ? sha256Bytes(concatBytes([current, other]))
          : sha256Bytes(concatBytes([other, current]));
    }
    if (!equalBytes(current, hexToBytes(proof.chunkTxRoot))) {
      return { ok: false, reason: "The NEAR Merkle branch does not reach the chunk transaction root." };
    }
    return { ok: true, reason: "The transaction is in the named NEAR chunk." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The NEAR proof could not be checked." };
  }
}
