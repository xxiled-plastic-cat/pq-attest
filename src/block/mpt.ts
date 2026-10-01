import { bytesToHex, equalBytes, hexToBytes } from "./bytes.ts";
import { keccak256 } from "./hash.ts";
import { rlpDecode, rlpEncode, type RlpItem } from "./rlp.ts";

const EMPTY_TRIE_ROOT = hexToBytes("56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421");

interface LeafNode {
  kind: "leaf";
  nibbles: number[];
  value: Uint8Array;
}

interface ExtensionNode {
  kind: "extension";
  nibbles: number[];
  child: TrieNode;
}

interface BranchNode {
  kind: "branch";
  children: Array<TrieNode | null>;
  value: Uint8Array | null;
}

type TrieNode = LeafNode | ExtensionNode | BranchNode;

export interface MptProof {
  keyHex: string;
  valueHex: string;
  nodes: string[];
}

export function emptyTrieRootHex(): string {
  return `0x${bytesToHex(EMPTY_TRIE_ROOT)}`;
}

export function transactionTrie(rawTransactions: Uint8Array[]): {
  rootHex: string;
  prove: (index: number) => MptProof;
} {
  let root: TrieNode | null = null;
  rawTransactions.forEach((raw, index) => {
    root = insert(root, nibblesOf(rlpEncode(index)), raw);
  });
  return {
    rootHex: `0x${bytesToHex(hashOf(root))}`,
    prove(index: number) {
      const key = rlpEncode(index);
      const value = rawTransactions[index];
      if (!value) {
        throw new Error(`Transaction index ${index} is outside this block.`);
      }
      return {
        keyHex: bytesToHex(key),
        valueHex: bytesToHex(value),
        nodes: collect(root, nibblesOf(key)).map((node) => bytesToHex(node)),
      };
    },
  };
}

export function verifyEvmInclusion(rootHex: string, proof: MptProof): { ok: boolean; reason: string } {
  try {
    const root = hexToBytes(strip0x(rootHex));
    const value = hexToBytes(proof.valueHex);
    let expected = root;
    let remaining = nibblesOf(hexToBytes(proof.keyHex));
    if (proof.nodes.length === 0) {
      return { ok: false, reason: "The transaction proof has no trie nodes." };
    }
    for (let i = 0; i < proof.nodes.length; i += 1) {
      const encoded = hexToBytes(proof.nodes[i]!);
      if (!matchesReference(expected, encoded)) {
        return { ok: false, reason: "A trie node does not match the hash expected by its parent." };
      }
      const decoded = rlpDecode(encoded);
      if (!Array.isArray(decoded.item)) {
        return { ok: false, reason: "A trie node is not an RLP list." };
      }
      const items = decoded.item.map((entry) => entry.item);
      if (items.length === 17) {
        if (remaining.length === 0) {
          return sameValue(asBytes(items[16]!), value);
        }
        const nibble = remaining[0]!;
        remaining = remaining.slice(1);
        expected = asReference(items[nibble]!);
        if (expected.length === 0) {
          return { ok: false, reason: "The trie branch for this transaction is empty." };
        }
      } else if (items.length === 2) {
        const path = decodeHp(asBytes(items[0]!));
        if (!startsWith(remaining, path.nibbles)) {
          return { ok: false, reason: "The trie path does not match this transaction index." };
        }
        remaining = remaining.slice(path.nibbles.length);
        if (path.leaf) {
          if (remaining.length !== 0) {
            return { ok: false, reason: "The trie leaf ended before the transaction index was consumed." };
          }
          if (i !== proof.nodes.length - 1) {
            return { ok: false, reason: "The proof continues after the transaction leaf." };
          }
          return sameValue(asBytes(items[1]!), value);
        }
        expected = asReference(items[1]!);
      } else {
        return { ok: false, reason: "A trie node has an unexpected shape." };
      }
    }
    return { ok: false, reason: "The proof ended before the transaction leaf." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The transaction proof could not be checked." };
  }
}

function sameValue(stored: Uint8Array, value: Uint8Array): { ok: boolean; reason: string } {
  if (!equalBytes(stored, value)) {
    return { ok: false, reason: "The trie leaf is a different transaction." };
  }
  return { ok: true, reason: "The transaction is in the Merkle Patricia trie." };
}

function matchesReference(expected: Uint8Array, encoded: Uint8Array): boolean {
  if (equalBytes(expected, keccak256(encoded))) {
    return true;
  }
  return expected.length < 32 && equalBytes(expected, encoded);
}

function asBytes(item: Uint8Array | unknown[]): Uint8Array {
  if (item instanceof Uint8Array) {
    return item;
  }
  throw new Error("Expected an RLP byte string inside the trie node.");
}

function asReference(item: Uint8Array | unknown[]): Uint8Array {
  if (item instanceof Uint8Array) {
    return item;
  }
  return rlpEncode(nestedToRlp(item));
}

function nestedToRlp(item: unknown): RlpItem {
  if (item instanceof Uint8Array) {
    return item;
  }
  if (Array.isArray(item)) {
    return item.map((entry) => {
      if (entry && typeof entry === "object" && "item" in entry) {
        return nestedToRlp((entry as { item: unknown }).item);
      }
      return nestedToRlp(entry);
    });
  }
  throw new Error("Trie reference is not an RLP item.");
}

function insert(node: TrieNode | null, key: number[], value: Uint8Array): TrieNode {
  if (!node) {
    return { kind: "leaf", nibbles: key, value };
  }
  if (node.kind === "leaf") {
    const shared = commonPrefix(node.nibbles, key);
    if (shared === key.length && shared === node.nibbles.length) {
      return { kind: "leaf", nibbles: key, value };
    }
    const branch = emptyBranch();
    graft(branch, node.nibbles.slice(shared), { kind: "leaf", nibbles: [], value: node.value });
    graft(branch, key.slice(shared), { kind: "leaf", nibbles: [], value });
    return shared === 0 ? branch : { kind: "extension", nibbles: key.slice(0, shared), child: branch };
  }
  if (node.kind === "extension") {
    const shared = commonPrefix(node.nibbles, key);
    if (shared === node.nibbles.length) {
      return { kind: "extension", nibbles: node.nibbles, child: insert(node.child, key.slice(shared), value) };
    }
    const branch = emptyBranch();
    const rest = node.nibbles.slice(shared);
    if (rest.length === 1) {
      branch.children[rest[0]!] = node.child;
    } else {
      branch.children[rest[0]!] = { kind: "extension", nibbles: rest.slice(1), child: node.child };
    }
    graft(branch, key.slice(shared), { kind: "leaf", nibbles: [], value });
    return shared === 0 ? branch : { kind: "extension", nibbles: node.nibbles.slice(0, shared), child: branch };
  }
  if (key.length === 0) {
    return { kind: "branch", children: node.children, value };
  }
  const children = node.children.slice();
  children[key[0]!] = insert(node.children[key[0]!] ?? null, key.slice(1), value);
  return { kind: "branch", children, value: node.value };
}

function graft(branch: BranchNode, path: number[], leaf: LeafNode): void {
  if (path.length === 0) {
    branch.value = leaf.value;
    return;
  }
  const nibble = path[0]!;
  branch.children[nibble] = path.length === 1 ? leaf : { kind: "leaf", nibbles: path.slice(1), value: leaf.value };
}

function emptyBranch(): BranchNode {
  return { kind: "branch", children: Array.from({ length: 16 }, () => null), value: null };
}

function commonPrefix(left: number[], right: number[]): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function hashOf(node: TrieNode | null): Uint8Array {
  if (!node) {
    return EMPTY_TRIE_ROOT;
  }
  return keccak256(encodeNode(node));
}

function encodeNode(node: TrieNode): Uint8Array {
  return rlpEncode(nodeToRlp(node));
}

function nodeToRlp(node: TrieNode): RlpItem {
  if (node.kind === "leaf") {
    return [hexPrefix(node.nibbles, true), node.value];
  }
  if (node.kind === "extension") {
    return [hexPrefix(node.nibbles, false), childReference(node.child)];
  }
  const children: RlpItem[] = node.children.map((child) => (child ? childReference(child) : new Uint8Array()));
  children.push(node.value ?? new Uint8Array());
  return children;
}

function childReference(node: TrieNode): RlpItem {
  const encoded = encodeNode(node);
  if (encoded.length < 32) {
    return nodeToRlp(node);
  }
  return keccak256(encoded);
}

function collect(node: TrieNode | null, key: number[]): Uint8Array[] {
  if (!node) {
    throw new Error("This transaction is not in the block.");
  }
  const encoded = encodeNode(node);
  if (node.kind === "leaf") {
    return [encoded];
  }
  if (node.kind === "extension") {
    if (!startsWith(key, node.nibbles)) {
      throw new Error("This transaction is not in the block.");
    }
    return [encoded, ...collect(node.child, key.slice(node.nibbles.length))];
  }
  if (key.length === 0) {
    return [encoded];
  }
  return [encoded, ...collect(node.children[key[0]!] ?? null, key.slice(1))];
}

function hexPrefix(nibbles: number[], leaf: boolean): Uint8Array {
  const flag = (leaf ? 2 : 0) + (nibbles.length % 2);
  if (nibbles.length % 2 === 1) {
    const packed = [(flag << 4) | (nibbles[0]! & 0xf)];
    for (let i = 1; i < nibbles.length; i += 2) {
      packed.push(((nibbles[i]! & 0xf) << 4) | (nibbles[i + 1]! & 0xf));
    }
    return new Uint8Array(packed);
  }
  const packed = [flag << 4];
  for (let i = 0; i < nibbles.length; i += 2) {
    packed.push(((nibbles[i]! & 0xf) << 4) | (nibbles[i + 1]! & 0xf));
  }
  return new Uint8Array(packed);
}

function decodeHp(bytes: Uint8Array): { nibbles: number[]; leaf: boolean } {
  if (bytes.length === 0) {
    return { nibbles: [], leaf: false };
  }
  const flag = bytes[0]! >> 4;
  const nibbles: number[] = [];
  if ((flag & 1) === 1) {
    nibbles.push(bytes[0]! & 0xf);
  }
  for (let i = 1; i < bytes.length; i += 1) {
    nibbles.push(bytes[i]! >> 4, bytes[i]! & 0xf);
  }
  return { nibbles, leaf: (flag & 2) === 2 };
}

function nibblesOf(bytes: Uint8Array): number[] {
  const nibbles: number[] = [];
  for (const byte of bytes) {
    nibbles.push(byte >> 4, byte & 0xf);
  }
  return nibbles;
}

function startsWith(nibbles: number[], prefix: number[]): boolean {
  return prefix.length <= nibbles.length && prefix.every((nibble, index) => nibbles[index] === nibble);
}

function strip0x(hex: string): string {
  return hex.replace(/^0x/i, "");
}
