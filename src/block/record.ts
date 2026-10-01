import { canonicalJson } from "../canonical.ts";
import type { SourceChain } from "../source.ts";
import { utf8 } from "./bytes.ts";
import { blockCapabilities } from "./capabilities.ts";
import type { FetchedBlock } from "./types.ts";

/** Canonical JSON record for chains whose hash is node-reported. */
export function reportedBlock(
  chain: SourceChain,
  fields: {
    height: string;
    blockHash: string;
    parentHash: string;
    txCount: number;
    blockTime: string | null;
    txRoot?: string;
    extra?: Record<string, unknown>;
  },
): FetchedBlock {
  const capabilities = blockCapabilities(chain);
  const record = {
    blockHash: fields.blockHash,
    parentHash: fields.parentHash,
    height: fields.height,
    ...(fields.extra ?? {}),
  };
  return {
    height: fields.height,
    blockHash: fields.blockHash,
    parentHash: fields.parentHash,
    txRoot: fields.txRoot ?? "",
    txRootType: capabilities.txRootType,
    txCount: fields.txCount,
    blockTime: fields.blockTime,
    rawHeader: utf8(canonicalJson(record)),
    hashMode: capabilities.hashMode === "recomputed" ? "reported" : capabilities.hashMode,
    headerHash: capabilities.headerHash === "reported" || capabilities.hashMode === "reported" ? "reported" : capabilities.headerHash,
  };
}
