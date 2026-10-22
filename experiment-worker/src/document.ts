import {
  CONFIRMATIONS,
  ETHEREUM_EXPERIMENT_2_ID,
  ETHEREUM_EXPERIMENT_ID,
  ETHEREUM_TEST_BLOCKS,
  ETHEREUM_WINDOW_MS,
  EXPERIMENT_ID,
  MAX_ATOMIC_USDC,
  WINDOW_MS,
  type ExperimentChain,
} from "./constants.js";
import { paidCount, type ExperimentRun, type RunMode, type RunState } from "./run.js";

export type ExperimentStatus = "stopped" | "running" | "complete";

export interface ExperimentAttestation {
  height: number;
  blockHash: string | null;
  attestTxnId: string;
  attestedAt: string;
  paidUsdc: string;
  skipped: boolean;
  elapsedMs: number | null;
}

export interface ExperimentProfile {
  id: string;
  title: string;
  chain: ExperimentChain;
}

export interface ExperimentDocument {
  id: string;
  title: string;
  chain: ExperimentChain;
  confirmations: typeof CONFIRMATIONS;
  status: ExperimentStatus;
  run: ExperimentRun;
  mode: RunMode;
  preview: boolean;
  test: { paid: number; cap: number } | null;
  window: { start: string; end: string } | null;
  payment: {
    network: "algorand-mainnet";
    asset: "USDC";
    priceAtomicCap: string;
  };
  stats: {
    attested: number;
    failures: number;
    usdcSpent: string;
    tip: number | null;
    nextHeight: number | null;
    lag: typeof CONFIRMATIONS;
    lastError: string | null;
  };
  attestations: ExperimentAttestation[];
}

export const BITCOIN_PROFILE: ExperimentProfile = {
  id: EXPERIMENT_ID,
  title: "Bitcoin blocks, 24 hours",
  chain: "bitcoin",
};

export const ETHEREUM_PROFILE: ExperimentProfile = {
  id: ETHEREUM_EXPERIMENT_ID,
  title: "Ethereum blocks, 6 hours",
  chain: "ethereum",
};

export const ETHEREUM_RUN_2_PROFILE: ExperimentProfile = {
  id: ETHEREUM_EXPERIMENT_2_ID,
  title: "Ethereum blocks, 6 hours (2)",
  chain: "ethereum",
};

export function publicStatus(state: RunState, run: ExperimentRun, now: Date): ExperimentStatus {
  if (state.complete || (state.end !== null && Date.parse(state.end) <= now.getTime())) {
    return "complete";
  }
  if (run === "stop") {
    return "stopped";
  }
  return "running";
}

export function formatAtomicUsdc(amount: bigint): string {
  if (amount < 0n) {
    throw new Error("USDC amount must be non-negative.");
  }
  const scale = 1_000_000n;
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

export function usdcSpent(state: RunState): string {
  const total = state.attestations.reduce((sum, row) => sum + BigInt(row.paidAtomic), 0n);
  return formatAtomicUsdc(total);
}

export function toDocument(
  state: RunState,
  run: ExperimentRun,
  now: Date,
  profile: ExperimentProfile = BITCOIN_PROFILE,
): ExperimentDocument {
  const mode: RunMode = state.mode === "test" ? "test" : "window";
  return {
    id: profile.id,
    title: profile.title,
    chain: profile.chain,
    confirmations: CONFIRMATIONS,
    status: publicStatus(state, run, now),
    run,
    mode,
    preview: false,
    test: mode === "test" ? { paid: paidCount(state), cap: ETHEREUM_TEST_BLOCKS } : null,
    window: state.start !== null && state.end !== null ? { start: state.start, end: state.end } : null,
    payment: {
      network: "algorand-mainnet",
      asset: "USDC",
      priceAtomicCap: MAX_ATOMIC_USDC.toString(),
    },
    stats: {
      attested: state.attestations.length,
      failures: state.failureCount,
      usdcSpent: usdcSpent(state),
      tip: state.tip,
      nextHeight: state.nextHeight,
      lag: CONFIRMATIONS,
      lastError: state.lastError,
    },
    attestations: state.attestations.map((row) => ({
      height: row.height,
      blockHash: row.blockHash,
      attestTxnId: row.attestTxnId,
      attestedAt: row.attestedAt,
      paidUsdc: formatAtomicUsdc(BigInt(row.paidAtomic)),
      skipped: row.skipped,
      elapsedMs: row.elapsedMs,
    })),
  };
}

const PREVIEW_HEIGHT = 900000;
const PREVIEW_HASH = "aa".repeat(32);
const PREVIEW_TXN = "PREVIEWATTSTXN000000000000000000000000000000000000000000";

export function previewDocument(now: Date, profile: ExperimentProfile = BITCOIN_PROFILE): ExperimentDocument {
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const windowMs = profile.chain === "ethereum" ? ETHEREUM_WINDOW_MS : WINDOW_MS;
  const end = new Date(start.getTime() + windowMs);
  const blockHash = profile.chain === "ethereum" ? `0x${"aa".repeat(32)}` : "aa".repeat(32);
  return {
    id: profile.id,
    title: profile.title,
    chain: profile.chain,
    confirmations: CONFIRMATIONS,
    status: "running",
    run: "start",
    mode: "window",
    preview: true,
    test: null,
    window: { start: start.toISOString(), end: end.toISOString() },
    payment: {
      network: "algorand-mainnet",
      asset: "USDC",
      priceAtomicCap: MAX_ATOMIC_USDC.toString(),
    },
    stats: {
      attested: 1,
      failures: 0,
      usdcSpent: "0.001",
      tip: PREVIEW_HEIGHT + CONFIRMATIONS,
      nextHeight: PREVIEW_HEIGHT + 1,
      lag: CONFIRMATIONS,
      lastError: null,
    },
    attestations: [
      {
        height: PREVIEW_HEIGHT,
        blockHash,
        attestTxnId: PREVIEW_TXN,
        attestedAt: start.toISOString(),
        paidUsdc: "0.001",
        skipped: false,
        elapsedMs: 800,
      },
    ],
  };
}

export function previewEthereumDocument(
  now: Date,
  profile: ExperimentProfile = ETHEREUM_PROFILE,
): ExperimentDocument {
  return previewDocument(now, profile);
}

export function previewBundle(height: number, chain: ExperimentChain = "bitcoin"): unknown | null {
  if (height !== PREVIEW_HEIGHT) {
    return null;
  }
  const blockHash = chain === "ethereum" ? `0x${PREVIEW_HASH}` : PREVIEW_HASH;
  return {
    schema: "block-attest-v1",
    chain,
    height: String(PREVIEW_HEIGHT),
    blockHash,
    preview: true,
    anchor: { txnId: PREVIEW_TXN, note: `block-attest:v1:${chain}:${PREVIEW_HEIGHT}:${blockHash}` },
  };
}
