import { CONFIRMATIONS, WINDOW_MS } from "./constants.js";

export type ExperimentRun = "start" | "stop";

export interface AttestationRecord {
  height: number;
  blockHash: string | null;
  attestTxnId: string;
  attestedAt: string;
  paidAtomic: string;
  skipped: boolean;
}

export interface RunState {
  start: string | null;
  end: string | null;
  nextHeight: number | null;
  complete: boolean;
  tip: number | null;
  failureCount: number;
  lastError: string | null;
  attestations: AttestationRecord[];
}

export interface PaidAttestation {
  blockHash: string;
  attestTxnId: string;
  paidAtomic: string;
  bundle: unknown;
}

export interface ExistingAttest {
  txnId: string;
  blockHash: string;
}

export interface TickDeps {
  now: () => Date;
  tip: () => Promise<number>;
  findExisting: (height: number) => Promise<ExistingAttest | null>;
  pay: (height: number) => Promise<PaidAttestation>;
}

export interface TickOutcome {
  state: RunState;
  bundle: { height: number; body: unknown } | null;
}

export function parseExperimentRun(value: string | undefined): ExperimentRun {
  if (value === "start" || value === "stop") {
    return value;
  }
  throw new Error("EXPERIMENT_RUN must be start or stop.");
}

export function emptyState(): RunState {
  return {
    start: null,
    end: null,
    nextHeight: null,
    complete: false,
    tip: null,
    failureCount: 0,
    lastError: null,
    attestations: [],
  };
}

/** Height that is `CONFIRMATIONS` behind the tip, or null when the tip is too shallow. */
export function confirmedHeight(tip: number): number | null {
  if (!Number.isSafeInteger(tip) || tip < CONFIRMATIONS) {
    return null;
  }
  return tip - CONFIRMATIONS;
}

export function parseState(body: string): RunState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Stored experiment state is not JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored experiment state has the wrong shape.");
  }
  const record = parsed as Partial<RunState>;
  if (!Array.isArray(record.attestations)) {
    throw new Error("Stored experiment state has the wrong shape.");
  }
  return {
    start: typeof record.start === "string" ? record.start : null,
    end: typeof record.end === "string" ? record.end : null,
    nextHeight: typeof record.nextHeight === "number" ? record.nextHeight : null,
    complete: record.complete === true,
    tip: typeof record.tip === "number" ? record.tip : null,
    failureCount: typeof record.failureCount === "number" ? record.failureCount : 0,
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    attestations: record.attestations.filter(isAttestation),
  };
}

export async function runTick(state: RunState, run: ExperimentRun, deps: TickDeps): Promise<TickOutcome> {
  if (run === "stop") {
    return { state, bundle: null };
  }
  if (state.complete) {
    return { state, bundle: null };
  }

  const now = deps.now();
  if (state.end !== null && Date.parse(state.end) <= now.getTime()) {
    return { state: { ...state, complete: true }, bundle: null };
  }
  if (state.start !== null && state.nextHeight === null) {
    return { state: fail(state, "The experiment cursor is missing."), bundle: null };
  }

  let tip: number;
  try {
    tip = await deps.tip();
  } catch (error) {
    return { state: fail(state, messageOf(error)), bundle: null };
  }

  const ready = confirmedHeight(tip);
  if (state.start === null) {
    if (ready === null) {
      return { state: { ...state, tip }, bundle: null };
    }
    return attestHeight(
      {
        ...state,
        tip,
        start: now.toISOString(),
        end: new Date(now.getTime() + WINDOW_MS).toISOString(),
        nextHeight: ready,
        lastError: null,
      },
      ready,
      now,
      deps,
    );
  }

  const next: RunState = { ...state, tip };
  if (ready === null || next.nextHeight === null || next.nextHeight > ready) {
    return { state: next, bundle: null };
  }
  return attestHeight(next, next.nextHeight, now, deps);
}

async function attestHeight(state: RunState, height: number, now: Date, deps: TickDeps): Promise<TickOutcome> {
  try {
    const existing = await deps.findExisting(height);
    if (existing) {
      return {
        state: advance(state, {
          height,
          blockHash: existing.blockHash,
          attestTxnId: existing.txnId,
          attestedAt: now.toISOString(),
          paidAtomic: "0",
          skipped: true,
        }),
        bundle: null,
      };
    }
    const paid = await deps.pay(height);
    return {
      state: advance(state, {
        height,
        blockHash: paid.blockHash,
        attestTxnId: paid.attestTxnId,
        attestedAt: now.toISOString(),
        paidAtomic: paid.paidAtomic,
        skipped: false,
      }),
      bundle: { height, body: paid.bundle },
    };
  } catch (error) {
    return { state: fail(state, messageOf(error)), bundle: null };
  }
}

function advance(state: RunState, row: AttestationRecord): RunState {
  if (state.nextHeight === null) {
    throw new Error("The experiment cursor is missing.");
  }
  return {
    ...state,
    nextHeight: state.nextHeight + 1,
    lastError: null,
    attestations: [...state.attestations, row],
  };
}

function fail(state: RunState, lastError: string): RunState {
  return {
    ...state,
    failureCount: state.failureCount + 1,
    lastError,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The experiment tick failed.";
}

function isAttestation(value: unknown): value is AttestationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<AttestationRecord>;
  return (
    typeof record.height === "number" &&
    (typeof record.blockHash === "string" || record.blockHash === null) &&
    typeof record.attestTxnId === "string" &&
    typeof record.attestedAt === "string" &&
    typeof record.paidAtomic === "string" &&
    typeof record.skipped === "boolean"
  );
}
