import { CONFIRMATIONS, EXPERIMENT_ID, MAX_ATOMIC_USDC } from "./constants.js";
import { type ExperimentRun, type RunState } from "./run.js";

export type ExperimentStatus = "stopped" | "running" | "complete";

export interface ExperimentAttestation {
  height: number;
  blockHash: string | null;
  attestTxnId: string;
  attestedAt: string;
  paidUsdc: string;
  skipped: boolean;
}

export interface ExperimentDocument {
  id: typeof EXPERIMENT_ID;
  title: string;
  chain: "bitcoin";
  confirmations: typeof CONFIRMATIONS;
  status: ExperimentStatus;
  run: ExperimentRun;
  preview: boolean;
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

const TITLE = "Bitcoin blocks, 24 hours";

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

export function toDocument(state: RunState, run: ExperimentRun, now: Date): ExperimentDocument {
  return {
    id: EXPERIMENT_ID,
    title: TITLE,
    chain: "bitcoin",
    confirmations: CONFIRMATIONS,
    status: publicStatus(state, run, now),
    run,
    preview: false,
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
    })),
  };
}

const PREVIEW_HEIGHT = 900000;
const PREVIEW_HASH = "aa".repeat(32);
const PREVIEW_TXN = "PREVIEWATTSTXN000000000000000000000000000000000000000000";

export function previewDocument(now: Date): ExperimentDocument {
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    id: EXPERIMENT_ID,
    title: TITLE,
    chain: "bitcoin",
    confirmations: CONFIRMATIONS,
    status: "running",
    run: "start",
    preview: true,
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
        blockHash: PREVIEW_HASH,
        attestTxnId: PREVIEW_TXN,
        attestedAt: start.toISOString(),
        paidUsdc: "0.001",
        skipped: false,
      },
    ],
  };
}

export function previewBundle(height: number): unknown | null {
  if (height !== PREVIEW_HEIGHT) {
    return null;
  }
  return {
    schema: "block-attest-v1",
    chain: "bitcoin",
    height: String(PREVIEW_HEIGHT),
    blockHash: PREVIEW_HASH,
    preview: true,
    anchor: { txnId: PREVIEW_TXN, note: `block-attest:v1:bitcoin:${PREVIEW_HEIGHT}:${PREVIEW_HASH}` },
  };
}
