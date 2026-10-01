import { bytesToHex, concatBytes, equalBytes, hexToBytes } from "./bytes.ts";
import { sha512Half } from "./hash.ts";

const TXN_PREFIX = new Uint8Array([0x54, 0x58, 0x4e, 0x00]);
const INNER_PREFIX = new Uint8Array([0x4d, 0x49, 0x4e, 0x00]);
const LEDGER_PREFIX = new Uint8Array([0x4c, 0x57, 0x52, 0x00]);
const ZERO = new Uint8Array(32);

interface InnerNode {
  kind: "inner";
  children: Array<Node | null>;
}

interface LeafNode {
  kind: "leaf";
  hash: Uint8Array;
}

type Node = InnerNode | LeafNode;

export interface ShamapProof {
  keyHex: string;
  leafHex: string;
  /** Each level, from the root down, is 16 child hashes (64 hex chars, or 64 zeros). */
  levels: string[][];
}

export function xrplTransactionId(serialized: Uint8Array): Uint8Array {
  return sha512Half(concatBytes([TXN_PREFIX, serialized]));
}

export function xrplLedgerHash(serializedHeader: Uint8Array): Uint8Array {
  return sha512Half(concatBytes([LEDGER_PREFIX, serializedHeader]));
}

export function shamapRoot(items: Array<{ key: Uint8Array; hash: Uint8Array }>): Uint8Array {
  return hashNode(build(items));
}

export function shamapProof(items: Array<{ key: Uint8Array; hash: Uint8Array }>, key: Uint8Array): ShamapProof {
  const root = build(items);
  const levels: string[][] = [];
  let node: Node | null = root;
  for (let depth = 0; depth < 64; depth += 1) {
    if (!node || node.kind === "leaf") {
      break;
    }
    levels.push(node.children.map((child) => bytesToHex(child ? hashNode(child) : ZERO)));
    node = node.children[nibbleAt(key, depth)] ?? null;
  }
  if (!node || node.kind !== "leaf" || !equalBytes(node.hash, hashNode(node))) {
    throw new Error("This transaction is not in the ledger SHAMap.");
  }
  return { keyHex: bytesToHex(key), leafHex: bytesToHex(node.hash), levels };
}

export function verifyShamap(root: Uint8Array, proof: ShamapProof): { ok: boolean; reason: string } {
  try {
    const key = hexToBytes(proof.keyHex);
    const leaf = hexToBytes(proof.leafHex);
    if (!equalBytes(leaf, key)) {
      return { ok: false, reason: "The SHAMap leaf is not the transaction id." };
    }
    let current = root;
    for (let depth = 0; depth < proof.levels.length; depth += 1) {
      const level = proof.levels[depth]!;
      if (level.length !== 16) {
        return { ok: false, reason: "A SHAMap node does not have 16 branches." };
      }
      const children = level.map((hex) => hexToBytes(hex));
      const hashed = sha512Half(concatBytes([INNER_PREFIX, ...children]));
      if (!equalBytes(hashed, current)) {
        return { ok: false, reason: "A SHAMap node does not match the hash expected by its parent." };
      }
      current = children[nibbleAt(key, depth)]!;
    }
    if (!equalBytes(current, leaf)) {
      return { ok: false, reason: "The SHAMap path does not end at this transaction." };
    }
    return { ok: true, reason: "The transaction is in the XRPL SHAMap." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The SHAMap proof could not be checked." };
  }
}

function build(items: Array<{ key: Uint8Array; hash: Uint8Array }>): Node | null {
  let root: Node | null = null;
  for (const item of items) {
    root = insert(root, item.key, item.hash, 0);
  }
  return root;
}

function insert(node: Node | null, key: Uint8Array, hash: Uint8Array, depth: number): Node {
  if (depth > 64) {
    throw new Error("SHAMap key is deeper than 64 nibbles.");
  }
  if (!node) {
    if (depth === 0) {
      const branch = emptyInner();
      branch.children[nibbleAt(key, 0)] = { kind: "leaf", hash };
      return branch;
    }
    return { kind: "leaf", hash };
  }
  if (node.kind === "leaf") {
    if (equalBytes(node.hash, hash)) {
      return node;
    }
    const branch = emptyInner();
    const existing = node.hash;
    branch.children[nibbleAt(existing, depth)] = insert(null, existing, existing, depth + 1);
    const nibble = nibbleAt(key, depth);
    branch.children[nibble] = insert(branch.children[nibble] ?? null, key, hash, depth + 1);
    return branch;
  }
  const nibble = nibbleAt(key, depth);
  const children = node.children.slice();
  children[nibble] = insert(node.children[nibble] ?? null, key, hash, depth + 1);
  return { kind: "inner", children };
}

function emptyInner(): InnerNode {
  return { kind: "inner", children: Array.from({ length: 16 }, () => null) };
}

function hashNode(node: Node | null): Uint8Array {
  if (!node) {
    return ZERO;
  }
  if (node.kind === "leaf") {
    return node.hash;
  }
  const children = node.children.map((child) => hashNode(child));
  return sha512Half(concatBytes([INNER_PREFIX, ...children]));
}

function nibbleAt(key: Uint8Array, depth: number): number {
  const byte = key[Math.floor(depth / 2)] ?? 0;
  return depth % 2 === 0 ? byte >> 4 : byte & 0xf;
}
