import assert from "node:assert/strict";
import test from "node:test";

import { ETHEREUM_EXPERIMENT_ID, experimentObjectName } from "../src/constants.js";
import { ETHEREUM_PROFILE, ETHEREUM_RUN_2_PROFILE } from "../src/document.js";
import { matchRoute } from "../src/routes.js";
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

test("a 429 from PublicNode reads the tip from the next public RPC", async () => {
  const calls: string[] = [];
  const tip = await fetchEthereumTip("https://ethereum.publicnode.com", async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("publicnode")) {
      return new Response("slow down", { status: 429 });
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2a" });
  });
  assert.equal(tip, 42);
  assert.deepEqual(calls, ["https://ethereum.publicnode.com", "https://eth.llamarpc.com"]);
});

test("a public RPC that asks for an API key is skipped", async () => {
  const calls: string[] = [];
  const tip = await fetchEthereumTip("https://ethereum.publicnode.com", async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("publicnode")) {
      return new Response("slow down", { status: 429 });
    }
    if (url.includes("llamarpc")) {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Unauthorized: You must authenticate your request with an API key" },
      });
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2a" });
  });
  assert.equal(tip, 42);
  assert.deepEqual(calls, ["https://ethereum.publicnode.com", "https://eth.llamarpc.com", "https://1rpc.io/eth"]);
});

test("a private Ethereum RPC does not fall over after a 429", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () =>
      fetchEthereumTip("https://rpc.example", async (input) => {
        calls.push(String(input));
        return new Response("slow down", { status: 429 });
      }),
    /429/,
  );
  assert.deepEqual(calls, ["https://rpc.example"]);
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
  assert.equal(experimentObjectName("2026-10-19c", ETHEREUM_EXPERIMENT_ID), "ethereum-blocks-6h:2026-10-19c");
  assert.equal(experimentObjectName("2026-10-22", ETHEREUM_EXPERIMENT_ID), "ethereum-blocks-6h:2026-10-22");
  assert.notEqual(
    experimentObjectName("2026-10-19c", ETHEREUM_EXPERIMENT_ID),
    experimentObjectName("2026-10-22", ETHEREUM_EXPERIMENT_ID),
  );
});

test("ethereum run 2 keeps its own public id", () => {
  assert.equal(ETHEREUM_PROFILE.id, "ethereum-blocks-6h");
  assert.equal(ETHEREUM_RUN_2_PROFILE.id, "ethereum-blocks-6h-2");
  assert.equal(ETHEREUM_RUN_2_PROFILE.chain, "ethereum");
});

test("ethereum archive routes stay separate from the live run", () => {
  assert.deepEqual(matchRoute("/ethereum"), { chain: "ethereum", height: null, archive: false });
  assert.deepEqual(matchRoute("/ethereum/"), { chain: "ethereum", height: null, archive: false });
  assert.deepEqual(matchRoute("/ethereum/attestations/123"), {
    chain: "ethereum",
    height: 123,
    archive: false,
  });
  assert.deepEqual(matchRoute("/ethereum/archive"), { chain: "ethereum", height: null, archive: true });
  assert.deepEqual(matchRoute("/ethereum/archive/attestations/456"), {
    chain: "ethereum",
    height: 456,
    archive: true,
  });
  assert.equal(matchRoute("/ethereum/archive/nope"), null);
});
