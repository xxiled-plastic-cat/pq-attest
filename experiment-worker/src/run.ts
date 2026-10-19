import {
  CONFIRMATIONS,
  ETHEREUM_POLL_MS,
  ETHEREUM_TEST_BLOCKS,
  WINDOW_MS,
} from "./constants.js";

export type ExperimentRun = "start" | "stop" | "test";
export type RunMode = "window" | "test";

export interface AttestationRecord {
  height: number;
  blockHash: string | null;
  attestTxnId: string;
  attestedAt: string;
  paidAtomic: string;
  skipped: boolean;
  elapsedMs: number | null;
}

export interface RunState {
  start: string | null;
  end: string | null;
  nextHeight: number | null;
  complete: boolean;
  tip: number | null;
  failureCount: number;
  lastError: string | null;
  mode: RunMode | null;
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
  /** Window length for a `start` run. Bitcoin keeps the 24 hour default. */
  windowMs?: number;
}

export interface TickOutcome {
  state: RunState;
  bundle: { height: number; body: unknown } | null;
}

export interface BurstOutcome {
  state: RunState;
  bundles: { height: number; body: unknown }[];
}

const TEST_OBJECT = "This object is the paid test. Start the 6-hour run on a new epoch.";
const WINDOW_OBJECT = "This object is the 6-hour run. Start the paid test on a new epoch.";

export function parseExperimentRun(value: string | undefined): ExperimentRun {
  if (value === "start" || value === "stop") {
    return value;
  }
  throw new Error("EXPERIMENT_RUN must be start or stop.");
}

export function parseEthereumRun(value: string | undefined): ExperimentRun {
  if (value === "start" || value === "stop" || value === "test") {
    return value;
  }
  throw new Error("ETHEREUM_EXPERIMENT_RUN must be start, test, or stop.");
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
    mode: null,
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

export function paidCount(state: RunState): number {
  return state.attestations.reduce((sum, row) => sum + (row.skipped ? 0 : 1), 0);
}

/**
 * Delay before the next Ethereum alarm.
 * Null clears the alarm. Zero means a clean burst left confirmed heights still waiting.
 */
export function nextAlarmDelay(state: RunState, run: ExperimentRun): number | null {
  if (run === "stop" || state.complete) {
    return null;
  }
  const ready = state.tip === null ? null : confirmedHeight(state.tip);
  const moreReady =
    state.lastError === null && state.nextHeight !== null && ready !== null && state.nextHeight <= ready;
  return moreReady ? 0 : ETHEREUM_POLL_MS;
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
    mode: record.mode === "test" || record.mode === "window" ? record.mode : null,
    attestations: record.attestations.flatMap((row) => {
      const read = readAttestation(row);
      return read ? [read] : [];
    }),
  };
}

export async function runTick(state: RunState, run: ExperimentRun, deps: TickDeps): Promise<TickOutcome> {
  if (run === "stop") {
    return { state, bundle: null };
  }
  if (state.complete) {
    return { state, bundle: null };
  }
  if (state.mode === "test" && run === "start") {
    return held(state, TEST_OBJECT);
  }
  if (state.mode === "window" && run === "test") {
    return held(state, WINDOW_OBJECT);
  }

  const now = deps.now();
  if (state.end !== null && Date.parse(state.end) <= now.getTime()) {
    return { state: { ...state, complete: true }, bundle: null };
  }
  if (state.start !== null && state.nextHeight === null) {
    return { state: fail(state, "The experiment cursor is missing."), bundle: null };
  }
  if (run === "test" && paidCount(state) >= ETHEREUM_TEST_BLOCKS) {
    return { state: { ...state, complete: true }, bundle: null };
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
    if (run === "test") {
      const first = ready - (ETHEREUM_TEST_BLOCKS - 1);
      if (!Number.isSafeInteger(first) || first < 0) {
        return { state: fail({ ...state, tip }, "The chain is too shallow for the 30-block test."), bundle: null };
      }
      return attestHeight(
        {
          ...state,
          tip,
          start: now.toISOString(),
          end: null,
          nextHeight: first,
          mode: "test",
          lastError: null,
        },
        first,
        now,
        deps,
        run,
      );
    }
    const windowMs = deps.windowMs ?? WINDOW_MS;
    return attestHeight(
      {
        ...state,
        tip,
        start: now.toISOString(),
        end: new Date(now.getTime() + windowMs).toISOString(),
        nextHeight: ready,
        mode: "window",
        lastError: null,
      },
      ready,
      now,
      deps,
      run,
    );
  }

  const next: RunState = { ...state, tip };
  if (ready === null || next.nextHeight === null || next.nextHeight > ready) {
    return { state: next, bundle: null };
  }
  return attestHeight(next, next.nextHeight, now, deps, run);
}

export async function runBurst(
  state: RunState,
  run: ExperimentRun,
  deps: TickDeps,
  maxPerTick: number,
  persist?: (before: RunState, outcome: TickOutcome) => void,
): Promise<BurstOutcome> {
  if (!Number.isSafeInteger(maxPerTick) || maxPerTick < 1) {
    throw new Error("Burst size must be a positive integer.");
  }
  let current = state;
  const bundles: BurstOutcome["bundles"] = [];
  for (let index = 0; index < maxPerTick; index += 1) {
    if (run === "stop" || current.complete) {
      break;
    }
    const started = deps.now().getTime();
    const outcome = withElapsed(current, await runTick(current, run, deps), deps.now().getTime() - started);
    persist?.(current, outcome);
    if (outcome.bundle) {
      bundles.push(outcome.bundle);
    }
    const progressed = outcome.state.attestations.length > current.attestations.length;
    current = outcome.state;
    if (!progressed || current.complete) {
      break;
    }
  }
  return { state: current, bundles };
}

async function attestHeight(
  state: RunState,
  height: number,
  now: Date,
  deps: TickDeps,
  run: ExperimentRun,
): Promise<TickOutcome> {
  try {
    if (run !== "test") {
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
            elapsedMs: null,
          }),
          bundle: null,
        };
      }
    }
    const paid = await deps.pay(height);
    const next = advance(state, {
      height,
      blockHash: paid.blockHash,
      attestTxnId: paid.attestTxnId,
      attestedAt: now.toISOString(),
      paidAtomic: paid.paidAtomic,
      skipped: false,
      elapsedMs: null,
    });
    return {
      state: run === "test" && paidCount(next) >= ETHEREUM_TEST_BLOCKS ? { ...next, complete: true } : next,
      bundle: { height, body: paid.bundle },
    };
  } catch (error) {
    return { state: fail(state, messageOf(error)), bundle: null };
  }
}

function withElapsed(before: RunState, outcome: TickOutcome, elapsedMs: number): TickOutcome {
  if (outcome.state.attestations.length <= before.attestations.length) {
    return outcome;
  }
  const attestations = outcome.state.attestations.slice();
  const last = attestations[attestations.length - 1];
  if (!last) {
    return outcome;
  }
  const stamped = Math.max(0, elapsedMs);
  attestations[attestations.length - 1] = { ...last, elapsedMs: Number.isFinite(stamped) ? stamped : null };
  return { ...outcome, state: { ...outcome.state, attestations } };
}

function held(state: RunState, message: string): TickOutcome {
  if (state.lastError === message) {
    return { state, bundle: null };
  }
  return { state: fail(state, message), bundle: null };
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

function readAttestation(value: unknown): AttestationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<AttestationRecord>;
  if (
    typeof record.height !== "number" ||
    !(typeof record.blockHash === "string" || record.blockHash === null) ||
    typeof record.attestTxnId !== "string" ||
    typeof record.attestedAt !== "string" ||
    typeof record.paidAtomic !== "string" ||
    typeof record.skipped !== "boolean"
  ) {
    return null;
  }
  return {
    height: record.height,
    blockHash: record.blockHash,
    attestTxnId: record.attestTxnId,
    attestedAt: record.attestedAt,
    paidAtomic: record.paidAtomic,
    skipped: record.skipped,
    elapsedMs: typeof record.elapsedMs === "number" && Number.isFinite(record.elapsedMs) ? record.elapsedMs : null,
  };
}
