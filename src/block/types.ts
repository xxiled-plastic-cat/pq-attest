import type { SourceChain } from "../source.ts";

export type ChainFamily =
  | "evm"
  | "algorand"
  | "solana"
  | "xrpl"
  | "bitcoin"
  | "aptos"
  | "sui"
  | "near"
  | "ton"
  | "hedera"
  | "stellar";

export type InclusionMode = "native" | "rebuilt" | "unsupported";
export type HashMode = "recomputed" | "reported";

export type HeaderHash =
  | "evm-keccak"
  | "algo-bh"
  | "btc-dsha256"
  | "xrpl-lwr"
  | "stellar-xdr"
  | "reported";

export interface BlockCapabilities {
  chain: SourceChain;
  chainFamily: ChainFamily;
  network: string;
  blockAttest: true;
  inclusionProof: InclusionMode;
  hashMode: HashMode;
  headerHash: HeaderHash;
  txRootType: string;
  finalityNote: string;
  /** Why inclusion is unsupported, when it is. */
  inclusionNote?: string;
}

export interface BlockAnchor {
  txnId: string;
  round: number;
  note: string;
}

export interface BlockAttestor {
  algorandAddress: string;
  pqPublicKey: string;
}

export interface UnsignedBlockAttest {
  schema: "block-attest-v1";
  chainFamily: ChainFamily;
  chain: SourceChain;
  network: string;
  height: string;
  blockHash: string;
  parentHash: string;
  txRoot: string;
  txRootType: string;
  txCount: number;
  timestamp: { blockTime: string | null; attestedAt: string };
  rawHeader: string;
  hashMode: HashMode;
  headerHash: HeaderHash;
  commitments?: { [key: string]: string };
  anchor: BlockAnchor;
  attestor: BlockAttestor;
}

export interface BlockAttestBundle extends UnsignedBlockAttest {
  signature: { alg: "ML-DSA-65"; sigBase64: string };
}

export interface EvmProof {
  type: "evm-mpt-keccak";
  keyHex: string;
  valueHex: string;
  nodes: string[];
}

export interface AlgorandProof {
  type: "algo-sha512_256";
  index: number;
  treeDepth: number;
  hashType: "sha512_256";
  stibHashHex: string;
  siblingsHex: string;
}

export interface BitcoinProof {
  type: "btc-dsha256";
  index: number;
  siblings: string[];
}

export interface XrplProof {
  type: "xrpl-shamap";
  keyHex: string;
  leafHex: string;
  txHex: string;
  levels: string[][];
}

export interface NearProof {
  type: "near-chunk";
  shardId: string;
  chunkTxRoot: string;
  index: number;
  txHash: string;
  siblings: Array<{ hash: string; direction: "left" | "right" }>;
}

export type InclusionProofData = EvmProof | AlgorandProof | BitcoinProof | XrplProof | NearProof;

export interface TxInclusionV1 {
  schema: "tx-inclusion-v1";
  chainFamily: ChainFamily;
  chain: SourceChain;
  network: string;
  height: string;
  txId: string;
  leaf: { type: string; description: string };
  proof: InclusionProofData;
  blockAttest: BlockAttestBundle;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  reason: string;
}

export interface VerifyReport {
  ok: boolean;
  checks: CheckResult[];
}

export interface FetchedBlock {
  height: string;
  blockHash: string;
  parentHash: string;
  txRoot: string;
  txRootType: string;
  txCount: number;
  blockTime: string | null;
  rawHeader: Uint8Array;
  hashMode: HashMode;
  headerHash: HeaderHash;
  commitments?: { [key: string]: string };
}
