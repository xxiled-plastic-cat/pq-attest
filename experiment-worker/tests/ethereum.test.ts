import assert from "node:assert/strict";
import test from "node:test";

import { ETHEREUM_EXPERIMENT_ID, experimentObjectName } from "../src/constants.js";
import { fetchEthereumTip, parseEthereumTip } from "../src/ethereum.js";
import { parseEthereumRun } from "../src/run.js";

test("parses an eth_blockNumber result", () => {
  assert.equal(parseEthereumTip({ jsonrpc: "2.0", id: 1, result: "0x64" }), 100);
  assert.equal(parseEthereumTip({ result: "0x0" }), 0);
});

test("rejects a tip that is not a hex quantity", () => {
  assert.throws(() => parseEthereumTip({ result: "100" }), /height/);
  assert.throws(() => parseEthereumTip({ result: "0x" }), /height/);
  assert.throws(() => parseEthereumTip(null), /height/);
});

test("reads the tip from the Ethereum RPC", async () => {
  const tip = await fetchEthereumTip("https://ethereum.publicnode.com", async (input, init) => {
    assert.equal(String(input), "https://ethereum.publicnode.com");
    assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
    const body = JSON.parse(String(init?.body)) as { method?: string };
    assert.equal(body.method, "eth_blockNumber");
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2a" });
  });
  assert.equal(tip, 42);
});

test("surfaces a failed tip response", async () => {
  await assert.rejects(
    () => fetchEthereumTip("https://ethereum.publicnode.com/", async () => new Response("no", { status: 503 })),
    /503/,
  );
  await assert.rejects(() => fetchEthereumTip("  ", async () => new Response("")), /ETH_RPC_URL/);
});

test("ETHEREUM_EXPERIMENT_RUN accepts start, test, or stop", () => {
  assert.equal(parseEthereumRun("test"), "test");
  assert.equal(parseEthereumRun("start"), "start");
  assert.equal(parseEthereumRun("stop"), "stop");
  assert.throws(() => parseEthereumRun(undefined), /start, test, or stop/);
  assert.throws(() => parseEthereumRun("yes"), /start, test, or stop/);
});

test("a new ethereum epoch addresses a different Durable Object", () => {
  assert.equal(experimentObjectName(undefined, ETHEREUM_EXPERIMENT_ID), "ethereum-blocks-6h");
  assert.equal(experimentObjectName("2026-10-19", ETHEREUM_EXPERIMENT_ID), "ethereum-blocks-6h:2026-10-19");
});
