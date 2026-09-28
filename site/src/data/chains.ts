/** Kept in step with the API id rules in src/source.ts. */

export const chains = [
  {
    id: "algorand",
    label: "Algorand",
    hint: "52 base32 characters.",
    placeholder: "OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA",
    pattern: /^[A-Z2-7]{52}$/,
  },
  {
    id: "base",
    label: "Base",
    hint: "0x plus 64 hex characters.",
    placeholder: "0x and 64 hex characters",
    pattern: /^0x[0-9a-f]{64}$/,
  },
  {
    id: "ethereum",
    label: "Ethereum",
    hint: "0x plus 64 hex characters.",
    placeholder: "0x and 64 hex characters",
    pattern: /^0x[0-9a-f]{64}$/,
  },
  {
    id: "polygon",
    label: "Polygon",
    hint: "0x plus 64 hex characters.",
    placeholder: "0x and 64 hex characters",
    pattern: /^0x[0-9a-f]{64}$/,
  },
  {
    id: "arbitrum",
    label: "Arbitrum",
    hint: "0x plus 64 hex characters.",
    placeholder: "0x and 64 hex characters",
    pattern: /^0x[0-9a-f]{64}$/,
  },
  {
    id: "optimism",
    label: "Optimism",
    hint: "0x plus 64 hex characters.",
    placeholder: "0x and 64 hex characters",
    pattern: /^0x[0-9a-f]{64}$/,
  },
  {
    id: "avalanche",
    label: "Avalanche",
    hint: "0x plus 64 hex characters. C-Chain.",
    placeholder: "0x and 64 hex characters",
    pattern: /^0x[0-9a-f]{64}$/,
  },
  {
    id: "solana",
    label: "Solana",
    hint: "87–88 character signature.",
    placeholder: "87–88 character signature",
    pattern: /^[1-9A-HJ-NP-Za-km-z]{87,88}$/,
  },
  {
    id: "bitcoin",
    label: "Bitcoin",
    hint: "64 hex characters.",
    placeholder: "64 hex characters",
    pattern: /^[0-9a-f]{64}$/,
  },
  {
    id: "aptos",
    label: "Aptos",
    hint: "0x plus 64 hex characters.",
    placeholder: "0x and 64 hex characters",
    pattern: /^0x[0-9a-f]{64}$/,
  },
  {
    id: "sui",
    label: "Sui",
    hint: "43–44 character base58 digest.",
    placeholder: "43–44 character base58 digest",
    pattern: /^[1-9A-HJ-NP-Za-km-z]{43,44}$/,
  },
  {
    id: "near",
    label: "NEAR",
    hint: "43–44 character base58 digest.",
    placeholder: "43–44 character base58 digest",
    pattern: /^[1-9A-HJ-NP-Za-km-z]{43,44}$/,
  },
  {
    id: "ton",
    label: "TON",
    hint: "64 hex characters, or base64.",
    placeholder: "64 hex characters or base64",
    pattern: /^(?:[0-9a-f]{64}|[A-Za-z0-9+/_-]{43,48}={0,2})$/,
  },
  {
    id: "hedera",
    label: "Hedera",
    hint: "shard.realm.num@seconds.nanos",
    placeholder: "0.0.1234@1234567890.000000000",
    pattern: /^\d+\.\d+\.\d+@\d+\.\d+$/,
  },
  {
    id: "stellar",
    label: "Stellar",
    hint: "64 hex characters.",
    placeholder: "64 hex characters",
    pattern: /^[0-9a-f]{64}$/,
  },
  {
    id: "xrpl",
    label: "XRPL",
    hint: "64 hex characters.",
    placeholder: "64 hex characters",
    pattern: /^[0-9a-f]{64}$/,
  },
] as const;

export type ChainId = (typeof chains)[number]["id"];

const HEX64 = /^[0-9a-fA-F]{64}$/;

export function chainById(id: string) {
  return chains.find((chain) => chain.id === id);
}

export function resolveTxid(chainId: string, raw: string): { txid: string } | { error: string } {
  const chain = chainById(chainId);
  if (!chain) {
    return { error: "Choose a supported chain." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Enter a transaction id." };
  }
  const txid = normalizeTxid(trimmed, chain.id);
  if (!chain.pattern.test(txid)) {
    return { error: `This id does not match ${chain.label}. ${chain.hint}` };
  }
  return { txid };
}

function normalizeTxid(txid: string, chain: ChainId): string {
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
