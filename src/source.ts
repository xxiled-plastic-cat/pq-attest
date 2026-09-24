export type SourceChain = "algorand" | "base";

const ALGO_TXID = /^[A-Z2-7]{52}$/;
const BASE_TXID = /^0x[0-9a-fA-F]{64}$/;

export function resolveSourceRequest(
  txid: unknown,
  chain?: unknown,
): { txid: string; chain: SourceChain } {
  if (typeof txid !== "string" || txid.trim() === "") {
    throw new Error("txid must be a 52-character Algorand transaction id or a Base transaction hash.");
  }
  const trimmed = txid.trim();
  const inferred = inferChain(trimmed);
  if (!inferred) {
    throw new Error("txid must be a 52-character Algorand transaction id or a Base transaction hash.");
  }
  if (chain != null && chain !== "algorand" && chain !== "base") {
    throw new Error('chain must be "algorand" or "base".');
  }
  const requested = chain as SourceChain | undefined;
  if (requested && requested !== inferred) {
    throw new Error(`chain ${requested} does not match txid.`);
  }
  return {
    txid: inferred === "base" ? trimmed.toLowerCase() : trimmed,
    chain: inferred,
  };
}

function inferChain(txid: string): SourceChain | undefined {
  if (ALGO_TXID.test(txid)) {
    return "algorand";
  }
  if (BASE_TXID.test(txid)) {
    return "base";
  }
  return undefined;
}
