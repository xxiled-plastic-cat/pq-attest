import type { SourceChain } from "../../source.ts";
import { adapterFor, registerAdapter, type ChainAdapter } from "../adapter.ts";
import type { FetchLike } from "../http.ts";
import type { FetchedBlock } from "../types.ts";
import { algorandTransactionHeight, fetchAlgorandBlock, proveAlgorandTransaction } from "./algorand.ts";
import { bitcoinTransactionHeight, fetchBitcoinBlock, proveBitcoinTransaction } from "./bitcoin.ts";
import { evmTransactionHeight, fetchEvmBlock, proveEvmTransaction } from "./evm.ts";
import { fetchNearBlock, nearTransactionHeight, proveNearTransaction } from "./near.ts";
import { fetchAptosBlock, fetchHederaBlock, fetchSuiBlock, fetchTonBlock } from "./reported.ts";
import { fetchSolanaBlock } from "./solana.ts";
import { fetchStellarBlock } from "./stellar.ts";
import { fetchXrplBlock } from "./xrpl.ts";

const EVM = ["base", "ethereum", "polygon", "arbitrum", "optimism", "avalanche"] as const;

const evmAdapter: ChainAdapter = {
  fetchBlock: (chain, height, fetchImpl, env) => fetchEvmBlock(chain as (typeof EVM)[number], height, fetchImpl, env),
  proveInclusion: async (chain, height, txId, fetchImpl, env) => {
    const built = await proveEvmTransaction(chain as (typeof EVM)[number], height, txId, fetchImpl, env);
    return {
      proof: built.proof,
      leaf: { type: "evm-mpt", description: "RLP key is the transaction index. The value is the raw typed transaction." },
    };
  },
  resolveHeight: (chain, txId, fetchImpl, env) => evmTransactionHeight(chain as (typeof EVM)[number], txId, fetchImpl, env),
};

registerAdapter(EVM, evmAdapter);
registerAdapter(["algorand"], {
  fetchBlock: (_chain, height, fetchImpl, env) => fetchAlgorandBlock(height, fetchImpl, env),
  proveInclusion: (_chain, height, txId, fetchImpl, env) => proveAlgorandTransaction(height, txId, fetchImpl, env),
  resolveHeight: (_chain, txId, fetchImpl, env) => algorandTransactionHeight(txId, fetchImpl, env),
});
registerAdapter(["bitcoin"], {
  fetchBlock: (_chain, height, fetchImpl, env) => fetchBitcoinBlock(height, fetchImpl, env),
  proveInclusion: (_chain, height, txId, fetchImpl, env) => proveBitcoinTransaction(height, txId, fetchImpl, env),
  resolveHeight: (_chain, txId, fetchImpl, env) => bitcoinTransactionHeight(txId, fetchImpl, env),
});
registerAdapter(["xrpl"], {
  fetchBlock: (_chain, height, fetchImpl, env) => fetchXrplBlock(height, fetchImpl, env),
});
registerAdapter(["stellar"], {
  fetchBlock: (_chain, height, fetchImpl, env) => fetchStellarBlock(height, fetchImpl, env),
});
registerAdapter(["solana"], {
  fetchBlock: (_chain, height, fetchImpl, env) => fetchSolanaBlock(height, fetchImpl, env),
});
registerAdapter(["near"], {
  fetchBlock: (_chain, height, fetchImpl, env) => fetchNearBlock(height, fetchImpl, env),
  proveInclusion: (_chain, height, txId, fetchImpl, env) => proveNearTransaction(height, txId, fetchImpl, env),
  resolveHeight: (_chain, txId, fetchImpl, env) => nearTransactionHeight(txId, fetchImpl, env),
});
registerAdapter(["aptos"], { fetchBlock: (_c, height, fetchImpl, env) => fetchAptosBlock(height, fetchImpl, env) });
registerAdapter(["sui"], { fetchBlock: (_c, height, fetchImpl, env) => fetchSuiBlock(height, fetchImpl, env) });
registerAdapter(["hedera"], { fetchBlock: (_c, height, fetchImpl, env) => fetchHederaBlock(height, fetchImpl, env) });
registerAdapter(["ton"], { fetchBlock: (_c, height, fetchImpl, env) => fetchTonBlock(height, fetchImpl, env) });

export async function fetchBlock(
  chain: SourceChain,
  height: string,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<FetchedBlock> {
  return adapterFor(chain).fetchBlock(chain, height, fetchImpl, env);
}
