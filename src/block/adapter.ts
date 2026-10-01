import type { SourceChain } from "../source.ts";
import { blockCapabilities } from "./capabilities.ts";
import type { FetchLike } from "./http.ts";
import type { FetchedBlock, InclusionProofData, TxInclusionV1 } from "./types.ts";

export interface BuiltInclusion {
  proof: InclusionProofData;
  leaf: TxInclusionV1["leaf"];
}

export interface ChainAdapter {
  fetchBlock(chain: SourceChain, height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock>;
  proveInclusion?(
    chain: SourceChain,
    height: string,
    txId: string,
    fetchImpl: FetchLike,
    env: NodeJS.ProcessEnv,
  ): Promise<BuiltInclusion>;
  resolveHeight?(chain: SourceChain, txId: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<string>;
}

const adapters = new Map<SourceChain, ChainAdapter>();

export function registerAdapter(chains: readonly SourceChain[], adapter: ChainAdapter): void {
  for (const chain of chains) {
    adapters.set(chain, adapter);
  }
}

export function adapterFor(chain: SourceChain): ChainAdapter {
  const adapter = adapters.get(chain);
  if (!adapter) {
    throw new Error(`No block adapter for ${chain}.`);
  }
  return adapter;
}

export function assertInclusionSupported(chain: SourceChain): void {
  const capabilities = blockCapabilities(chain);
  if (capabilities.inclusionProof === "unsupported") {
    throw new Error(capabilities.inclusionNote ?? `${chain} does not support transaction inclusion proofs.`);
  }
}
