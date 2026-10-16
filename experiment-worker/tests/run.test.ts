import assert from "node:assert/strict";
import test from "node:test";

import { experimentObjectName } from "../src/constants.js";
import { toDocument } from "../src/document.js";
import {
  confirmedHeight,
  emptyState,
  parseExperimentRun,
  runTick,
  type PaidAttestation,
  type RunState,
  type TickDeps,
} from "../src/run.js";

const START = new Date("2026-10-16T12:00:00.000Z");

test("a new epoch addresses a different Durable Object than the first run", () => {
  assert.equal(experimentObjectName(undefined), "bitcoin-blocks-24h");
  assert.equal(experimentObjectName("  "), "bitcoin-blocks-24h");
  assert.equal(experimentObjectName("2026-10-16b"), "bitcoin-blocks-24h:2026-10-16b");
});

test("EXPERIMENT_RUN accepts only start or stop", () => {
  assert.equal(parseExperimentRun("start"), "start");
  assert.equal(parseExperimentRun("stop"), "stop");
  assert.throws(() => parseExperimentRun(undefined), /start or stop/);
  assert.throws(() => parseExperimentRun("yes"), /start or stop/);
});

test("confirmed height stays two behind the tip", () => {
  assert.equal(confirmedHeight(100), 98);
  assert.equal(confirmedHeight(2), 0);
  assert.equal(confirmedHeight(1), null);
  assert.equal(confirmedHeight(1.5), null);
});

test("stop does not open the window or pay", async () => {
  const deps = fakeDeps();
  const outcome = await runTick(emptyState(), "stop", deps);
  assert.equal(outcome.state.start, null);
  assert.equal(outcome.state.nextHeight, null);
  assert.equal(deps.paid.length, 0);
  assert.equal(deps.tips, 0);
});

test("start opens a 24 hour window and attests tip minus two", async () => {
  const deps = fakeDeps();
  const outcome = await runTick(emptyState(), "start", deps);
  assert.equal(outcome.state.start, START.toISOString());
  assert.equal(outcome.state.end, "2026-10-17T12:00:00.000Z");
  assert.deepEqual(deps.paid, [98]);
  assert.equal(outcome.state.nextHeight, 99);
  assert.equal(outcome.state.attestations[0]?.height, 98);
  assert.equal(outcome.state.attestations[0]?.paidAtomic, "1000");
  assert.equal(outcome.bundle?.height, 98);
});

test("a later start does not move the window", async () => {
  const deps = fakeDeps();
  const opened = await runTick(emptyState(), "start", deps);
  const later = fakeDeps(new Date("2026-10-16T13:00:00.000Z"), 100);
  const outcome = await runTick(opened.state, "start", later);
  assert.equal(outcome.state.start, START.toISOString());
  assert.equal(outcome.state.end, opened.state.end);
  assert.equal(later.paid.length, 0);
  assert.equal(outcome.state.nextHeight, 99);
});

test("stop mid-run does not advance the cursor", async () => {
  const opened = await runTick(emptyState(), "start", fakeDeps());
  const deps = fakeDeps(new Date("2026-10-16T13:00:00.000Z"), 110);
  const outcome = await runTick(opened.state, "stop", deps);
  assert.equal(outcome.state.nextHeight, opened.state.nextHeight);
  assert.equal(outcome.state.attestations.length, opened.state.attestations.length);
  assert.equal(deps.tips, 0);
  assert.equal(deps.paid.length, 0);
});

test("start after the end does not open a second window", async () => {
  const opened = await runTick(emptyState(), "start", fakeDeps());
  const deps = fakeDeps(new Date("2026-10-17T12:00:00.000Z"), 200);
  const outcome = await runTick(opened.state, "start", deps);
  assert.equal(outcome.state.complete, true);
  assert.equal(outcome.state.start, opened.state.start);
  assert.equal(outcome.state.nextHeight, opened.state.nextHeight);
  assert.equal(deps.paid.length, 0);

  const again = fakeDeps(new Date("2026-10-18T12:00:00.000Z"), 300);
  const reopened = await runTick(outcome.state, "start", again);
  assert.equal(reopened.state.complete, true);
  assert.equal(reopened.state.start, opened.state.start);
  assert.equal(again.paid.length, 0);
});

test("a failed payment does not advance the cursor", async () => {
  const deps = fakeDeps();
  deps.pay = async () => {
    throw new Error("settlement failed");
  };
  const outcome = await runTick(emptyState(), "start", deps);
  assert.equal(outcome.state.start, START.toISOString());
  assert.equal(outcome.state.nextHeight, 98);
  assert.equal(outcome.state.attestations.length, 0);
  assert.equal(outcome.state.failureCount, 1);
  assert.match(outcome.state.lastError ?? "", /settlement failed/);
  assert.equal(outcome.bundle, null);
});

test("tip and tip minus one are never selected", async () => {
  const opened = await runTick(emptyState(), "start", fakeDeps());
  const atTip = await runTick(withCursor(opened.state, 100), "start", fakeDeps(START, 100));
  assert.deepEqual(atTip.state.attestations.map((row) => row.height), [98]);
  assert.equal(atTip.state.nextHeight, 100);

  const oneBack = await runTick(withCursor(opened.state, 99), "start", fakeDeps(START, 100));
  assert.equal(oneBack.state.nextHeight, 99);
  assert.equal(oneBack.state.attestations.length, 1);
});

test("a tick attests one height when several are ready", async () => {
  const opened = await runTick(emptyState(), "start", fakeDeps());
  const deps = fakeDeps(new Date("2026-10-16T13:00:00.000Z"), 110);
  const outcome = await runTick(withCursor(opened.state, 90), "start", deps);
  assert.deepEqual(deps.paid, [90]);
  assert.equal(outcome.state.nextHeight, 91);
});

test("an existing attestor note skips payment and advances", async () => {
  const deps = fakeDeps();
  deps.findExisting = async () => ({ txnId: "EXISTING", blockHash: "ab".repeat(32) });
  const outcome = await runTick(emptyState(), "start", deps);
  assert.equal(deps.paid.length, 0);
  assert.equal(outcome.state.nextHeight, 99);
  assert.equal(outcome.state.attestations[0]?.attestTxnId, "EXISTING");
  assert.equal(outcome.state.attestations[0]?.paidAtomic, "0");
  assert.equal(outcome.state.attestations[0]?.skipped, true);
  assert.equal(outcome.bundle, null);
});

test("a tip fetch failure does not open the window", async () => {
  const deps = fakeDeps();
  deps.tip = async () => {
    throw new Error("mempool down");
  };
  const outcome = await runTick(emptyState(), "start", deps);
  assert.equal(outcome.state.start, null);
  assert.equal(outcome.state.failureCount, 1);
  assert.equal(deps.paid.length, 0);
});

test("public status follows the switch and the stored end", () => {
  const opened = {
    ...emptyState(),
    start: START.toISOString(),
    end: "2026-10-17T12:00:00.000Z",
    nextHeight: 99,
    tip: 100,
  };
  assert.equal(toDocument(emptyState(), "stop", START).status, "stopped");
  assert.equal(toDocument(emptyState(), "stop", START).window, null);
  assert.equal(toDocument(opened, "start", START).status, "running");
  assert.equal(toDocument(opened, "stop", new Date("2026-10-16T18:00:00.000Z")).status, "stopped");
  assert.equal(toDocument(opened, "stop", new Date("2026-10-17T12:00:00.000Z")).status, "complete");
  assert.equal(toDocument(opened, "start", new Date("2026-10-17T13:00:00.000Z")).status, "complete");
});

test("spent USDC sums only the atomic amounts that were paid", async () => {
  const deps = fakeDeps();
  const outcome = await runTick(emptyState(), "start", deps);
  const document = toDocument(outcome.state, "start", START);
  assert.equal(document.stats.attested, 1);
  assert.equal(document.stats.usdcSpent, "0.001");
  assert.equal(document.attestations[0]?.paidUsdc, "0.001");
});

function withCursor(state: RunState, nextHeight: number): RunState {
  return { ...state, nextHeight };
}

function fakeDeps(now = START, tip = 100): TickDeps & { paid: number[]; tips: number } {
  const tracker = { paid: [] as number[], tips: 0 };
  const deps: TickDeps & { paid: number[]; tips: number } = {
    paid: tracker.paid,
    get tips() {
      return tracker.tips;
    },
    now: () => now,
    tip: async () => {
      tracker.tips += 1;
      return tip;
    },
    findExisting: async () => null,
    pay: async (height: number) => {
      tracker.paid.push(height);
      return paidBundle(height);
    },
  };
  return deps;
}

function paidBundle(height: number): PaidAttestation {
  return {
    blockHash: "cd".repeat(32),
    attestTxnId: `TX${height}`,
    paidAtomic: "1000",
    bundle: { schema: "block-attest-v1", height: String(height) },
  };
}
