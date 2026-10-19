import assert from "node:assert/strict";
import test from "node:test";

import { ETHEREUM_POLL_MS, ETHEREUM_TEST_BLOCKS, ETHEREUM_WINDOW_MS } from "../src/constants.js";
import { ETHEREUM_PROFILE, toDocument } from "../src/document.js";
import {
  emptyState,
  nextAlarmDelay,
  paidCount,
  runBurst,
  type PaidAttestation,
  type RunState,
  type TickDeps,
} from "../src/run.js";

const START = new Date("2026-10-19T12:00:00.000Z");
const TIP = 1000;

test("one alarm pays at most 10 and the test stops at 30 paid blocks", async () => {
  const clock = { ms: START.getTime() };
  const paid: number[] = [];
  const deps = fakeDeps(clock, paid);
  let state = emptyState();

  const first = await runBurst(state, "test", deps, 10);
  assert.equal(paid.length, 10);
  assert.deepEqual(paid, heightsFrom(969, 10));
  assert.equal(first.state.complete, false);
  assert.equal(first.state.end, null);
  assert.equal(first.state.mode, "test");
  assert.equal(first.state.attestations[0]?.elapsedMs, 25);
  assert.equal(nextAlarmDelay(first.state, "test"), 0);
  state = first.state;

  const second = await runBurst(state, "test", deps, 10);
  assert.equal(paid.length, 20);
  assert.equal(nextAlarmDelay(second.state, "test"), 0);
  state = second.state;

  const third = await runBurst(state, "test", deps, 10);
  assert.equal(paid.length, ETHEREUM_TEST_BLOCKS);
  assert.deepEqual(paid, heightsFrom(969, 30));
  assert.equal(paid[29], TIP - 2);
  assert.equal(third.state.complete, true);
  assert.equal(third.state.nextHeight, TIP - 1);
  assert.equal(nextAlarmDelay(third.state, "test"), null);
  assert.equal(paidCount(third.state), 30);

  const extra = await runBurst(third.state, "test", deps, 10);
  assert.equal(paid.length, 30);
  assert.equal(extra.bundles.length, 0);

  const document = toDocument(third.state, "test", START, ETHEREUM_PROFILE);
  assert.equal(document.mode, "test");
  assert.equal(document.test?.paid, 30);
  assert.equal(document.test?.cap, 30);
  assert.equal(document.window, null);
  assert.equal(document.status, "complete");
});

test("a payment failure stops the burst and keeps the paid rows", async () => {
  const clock = { ms: START.getTime() };
  const paid: number[] = [];
  const deps = fakeDeps(clock, paid);
  deps.pay = async (height: number) => {
    if (paid.length === 4) {
      throw new Error("settlement failed");
    }
    clock.ms += 25;
    paid.push(height);
    return paidBundle(height);
  };
  const saved: RunState[] = [];
  const outcome = await runBurst(emptyState(), "test", deps, 10, (_before, step) => {
    saved.push(step.state);
  });
  assert.deepEqual(paid, heightsFrom(969, 4));
  assert.equal(outcome.state.attestations.length, 4);
  assert.equal(outcome.state.complete, false);
  assert.match(outcome.state.lastError ?? "", /settlement failed/);
  assert.equal(saved.at(-1)?.attestations.length, 4);
  assert.equal(nextAlarmDelay(outcome.state, "test"), ETHEREUM_POLL_MS);
});

test("test mode pays even when an attestor note already exists", async () => {
  const clock = { ms: START.getTime() };
  const paid: number[] = [];
  const deps = fakeDeps(clock, paid);
  deps.findExisting = async () => {
    throw new Error("test mode must not reuse an existing note");
  };
  const outcome = await runBurst(emptyState(), "test", deps, 1);
  assert.deepEqual(paid, [969]);
  assert.equal(outcome.state.attestations[0]?.skipped, false);
  assert.equal(outcome.state.attestations[0]?.paidAtomic, "1000");
});

test("a 6 hour run starts at tip minus two and does not pay unconfirmed heights", async () => {
  const clock = { ms: START.getTime() };
  const paid: number[] = [];
  const deps = fakeDeps(clock, paid);
  deps.windowMs = ETHEREUM_WINDOW_MS;
  const outcome = await runBurst(emptyState(), "start", deps, 10);
  assert.equal(outcome.state.end, "2026-10-19T18:00:00.000Z");
  assert.equal(outcome.state.mode, "window");
  assert.deepEqual(paid, heightsFrom(998, 1));
  assert.equal(outcome.state.nextHeight, 999);
  assert.equal(nextAlarmDelay(outcome.state, "start"), ETHEREUM_POLL_MS);
});

test("a 6 hour run catches up at most 10 confirmed heights", async () => {
  const clock = { ms: START.getTime() };
  const paid: number[] = [];
  const deps = fakeDeps(clock, paid);
  deps.windowMs = ETHEREUM_WINDOW_MS;
  const opened = await runBurst(emptyState(), "start", deps, 1);
  const behind = { ...opened.state, nextHeight: 900 };
  const outcome = await runBurst(behind, "start", deps, 10);
  assert.deepEqual(paid.slice(1), heightsFrom(900, 10));
  assert.equal(outcome.state.nextHeight, 910);
  assert.equal(outcome.state.complete, false);
  assert.ok(paid.every((height) => height <= TIP - 2));
});

function heightsFrom(start: number, count: number): number[] {
  return Array.from({ length: count }, (_value, index) => start + index);
}

function fakeDeps(clock: { ms: number }, paid: number[]): TickDeps {
  return {
    now: () => new Date(clock.ms),
    windowMs: ETHEREUM_WINDOW_MS,
    tip: async () => TIP,
    findExisting: async () => null,
    pay: async (height: number) => {
      clock.ms += 25;
      paid.push(height);
      return paidBundle(height);
    },
  };
}

function paidBundle(height: number): PaidAttestation {
  return {
    blockHash: `0x${"cd".repeat(32)}`,
    attestTxnId: `TX${height}`,
    paidAtomic: "1000",
    bundle: { schema: "block-attest-v1", chain: "ethereum", height: String(height) },
  };
}
