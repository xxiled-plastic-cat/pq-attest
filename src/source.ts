export const SOURCE_CHAINS = [
  "algorand",
  "base",
  "ethereum",
  "polygon",
  "arbitrum",
  "optimism",
  "avalanche",
  "solana",
  "bitcoin",
  "aptos",
  "sui",
  "near",
  "ton",
  "hedera",
  "stellar",
  "xrpl",
] as const;

export type SourceChain = (typeof SOURCE_CHAINS)[number];

const ALGO_TXID = /^[A-Z2-7]{52}$/;
const HEX64 = /^[0-9a-fA-F]{64}$/;
const SOLANA_SIG = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
const HEDERA_TXID = /^\d+\.\d+\.\d+@\d+\.\d+$/;
const BASE58_32 = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

const TXID_HELP =
  "txid must match the chain. Algorand is 52 base32 characters, Hedera is shard.realm.num@seconds.nanos, Solana is an 87–88 character signature, Base, Ethereum, Polygon, Arbitrum, Optimism, Avalanche, and Aptos are 0x plus 64 hex characters, Bitcoin, Stellar, and XRPL are 64 hex characters, Sui and NEAR are 43–44 character base58 digests, and TON is 64 hex characters or base64.";

export function isSourceChain(value: unknown): value is SourceChain {
  return typeof value === "string" && (SOURCE_CHAINS as readonly string[]).includes(value);
}

export function resolveSourceRequest(
  txid: unknown,
  chain?: unknown,
): { txid: string; chain: SourceChain } {
  if (!isSourceChain(chain)) {
    throw new Error(`chain is required and must be one of: ${SOURCE_CHAINS.join(", ")}.`);
  }
  if (typeof txid !== "string" || txid.trim() === "") {
    throw new Error(TXID_HELP);
  }
  const normalized = normalizeTxid(txid.trim(), chain);
  if (!txnIdPattern(chain).test(normalized)) {
    throw new Error(`chain ${chain} does not match txid.`);
  }
  return { txid: normalized, chain };
}

export function txnIdPattern(chain: SourceChain): RegExp {
  switch (chain) {
    case "algorand":
      return ALGO_TXID;
    case "base":
    case "ethereum":
    case "polygon":
    case "arbitrum":
    case "optimism":
    case "avalanche":
    case "aptos":
      return /^0x[0-9a-f]{64}$/;
    case "solana":
      return SOLANA_SIG;
    case "bitcoin":
    case "stellar":
    case "xrpl":
      return /^[0-9a-f]{64}$/;
    case "sui":
    case "near":
      return BASE58_32;
    case "hedera":
      return HEDERA_TXID;
    case "ton":
      return /^(?:[0-9a-f]{64}|[A-Za-z0-9+/_-]{43,48}={0,2})$/;
  }
}

function normalizeTxid(txid: string, chain: SourceChain): string {
  if (
    chain === "base" ||
    chain === "ethereum" ||
    chain === "polygon" ||
    chain === "arbitrum" ||
    chain === "optimism" ||
    chain === "avalanche" ||
    chain === "aptos"
  ) {
    return txid.toLowerCase();
  }
  if (chain === "bitcoin" || chain === "stellar" || chain === "xrpl") {
    return txid.toLowerCase();
  }
  if (chain === "ton" && HEX64.test(txid)) {
    return txid.toLowerCase();
  }
  return txid;
}
