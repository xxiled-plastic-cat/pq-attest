import type { SourceChain } from "../source.ts";
import type { BlockCapabilities } from "./types.ts";

const EVM_FINALITY =
  "The block is the one the node returned. This does not prove a safe or finalized tag, and it does not prove L2 finality on the parent chain.";

export const BLOCK_CAPABILITIES: readonly BlockCapabilities[] = [
  {
    chain: "algorand",
    chainFamily: "algorand",
    network: "algorand:mainnet-v1.0",
    blockAttest: true,
    inclusionProof: "native",
    hashMode: "recomputed",
    headerHash: "algo-bh",
    txRootType: "algo-sha512_256",
    finalityNote: "The round is the one algod already confirmed. A later round is not required.",
  },
  evm("base", "eip155:8453"),
  evm("ethereum", "eip155:1"),
  evm("polygon", "eip155:137"),
  evm("arbitrum", "eip155:42161"),
  evm("optimism", "eip155:10"),
  {
    ...evm("avalanche", "eip155:43114"),
    finalityNote:
      `${EVM_FINALITY} The header is hashed with the Coreth field order. If that encoding does not match the node, the bundle records the node-reported hash and still keeps transactionsRoot for inclusion proofs.`,
  },
  {
    chain: "solana",
    chainFamily: "solana",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    blockAttest: true,
    inclusionProof: "unsupported",
    hashMode: "reported",
    headerHash: "reported",
    txRootType: "none",
    finalityNote: "The slot is read at finalized commitment.",
    inclusionNote:
      "A Solana blockhash comes from Proof of History entries, not from a header that commits to a transaction root. There is no standard inclusion proof, so this chain attests the slot and blockhash only.",
  },
  {
    chain: "bitcoin",
    chainFamily: "bitcoin",
    network: "bitcoin:000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
    blockAttest: true,
    inclusionProof: "rebuilt",
    hashMode: "recomputed",
    headerHash: "btc-dsha256",
    txRootType: "btc-dsha256",
    finalityNote: "The block is confirmed (at least one confirmation). Six confirmations are the usual convention and are not proven.",
  },
  reported(
    "aptos",
    "aptos",
    "aptos:1",
    "A block height the fullnode has already committed.",
    "The Aptos fullnode publishes a consensus block hash, but not a header preimage or a compact per-block transaction proof. Inclusion proofs are refused.",
  ),
  {
    chain: "sui",
    chainFamily: "sui",
    network: "sui:mainnet",
    blockAttest: true,
    inclusionProof: "unsupported",
    hashMode: "reported",
    headerHash: "reported",
    txRootType: "none",
    finalityNote: "The checkpoint is the one the fullnode returned.",
    inclusionNote:
      "A Sui checkpoint digest is a BCS commitment. This service does not recompute that digest, and it does not invent an inclusion proof when the digest cannot be rebuilt. Block attestation records the checkpoint the node returned.",
  },
  {
    chain: "near",
    chainFamily: "near",
    network: "near:mainnet",
    blockAttest: true,
    inclusionProof: "rebuilt",
    hashMode: "reported",
    headerHash: "reported",
    txRootType: "near-chunk",
    finalityNote: "The block is the final block from the protocol RPC.",
    inclusionNote:
      "The block hash is a protocol-versioned Borsh header hash, so the bundle records the node-reported hash. Each shard chunk has its own tx_root. The inclusion proof names the shard and checks that chunk root.",
  },
  reported(
    "ton",
    "ton",
    "ton:mainnet",
    "The masterchain seqno TonAPI returned.",
    "TON commits account transactions through the shard account tree. TonAPI does not expose a standard inclusion proof, so only the block record is attested.",
  ),
  reported(
    "hedera",
    "hedera",
    "hedera:mainnet",
    "The mirror-node block number.",
    "A Hedera mirror-node block hash groups records for the mirror. It is not a consensus header with a transaction root, so inclusion proofs are refused.",
  ),
  {
    chain: "stellar",
    chainFamily: "stellar",
    network: "stellar:pubnet",
    blockAttest: true,
    inclusionProof: "unsupported",
    hashMode: "recomputed",
    headerHash: "stellar-xdr",
    txRootType: "none",
    finalityNote: "The ledger is the one Horizon has already closed.",
    inclusionNote:
      "The ledger header commits to tx_set_hash, which is a hash of the whole transaction set, not a Merkle root of one transaction. A single-transaction proof is refused.",
  },
  {
    chain: "xrpl",
    chainFamily: "xrpl",
    network: "xrpl:mainnet",
    blockAttest: true,
    inclusionProof: "unsupported",
    hashMode: "recomputed",
    headerHash: "xrpl-lwr",
    txRootType: "none",
    finalityNote: "The ledger is a validated ledger.",
    inclusionNote:
      "The ledger hash is recomputed from the header, which commits to transaction_hash. A per-transaction SHAMap proof is refused because the rebuilt tree does not match that root.",
  },
];

function evm(chain: SourceChain, network: string): BlockCapabilities {
  return {
    chain,
    chainFamily: "evm",
    network,
    blockAttest: true,
    inclusionProof: "rebuilt",
    hashMode: "recomputed",
    headerHash: "evm-keccak",
    txRootType: "evm-mpt-keccak",
    finalityNote: EVM_FINALITY,
  };
}

function reported(
  chain: SourceChain,
  chainFamily: BlockCapabilities["chainFamily"],
  network: string,
  finalityNote: string,
  inclusionNote: string,
): BlockCapabilities {
  return {
    chain,
    chainFamily,
    network,
    blockAttest: true,
    inclusionProof: "unsupported",
    hashMode: "reported",
    headerHash: "reported",
    txRootType: "none",
    finalityNote,
    inclusionNote,
  };
}

const byChain = new Map(BLOCK_CAPABILITIES.map((entry) => [entry.chain, entry]));

export function blockCapabilities(chain: SourceChain): BlockCapabilities {
  const found = byChain.get(chain);
  if (!found) {
    throw new Error(`No block adapter for ${chain}.`);
  }
  return found;
}
