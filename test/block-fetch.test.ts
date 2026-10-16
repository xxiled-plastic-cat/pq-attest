import assert from "node:assert/strict";
import test from "node:test";
import { fetchAlgorandBlock } from "../src/block/adapters/algorand.ts";
import { fetchBitcoinBlock } from "../src/block/adapters/bitcoin.ts";
import type { FetchLike } from "../src/block/http.ts";

const BITCOIN_HASH = "00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054";
const BITCOIN_HEADER =
  "00601d3455bb9fbd966b3ea2dc42d0c22722e4c0c1729fad17210100000000000000000055087fab0c8f3f89f8bcfd4df26c504d81b0a88e04907161838c0c53001af09135edbd64943805175e955e06";
const BITCOIN_INFO = {
  id: BITCOIN_HASH,
  height: 800000,
  timestamp: 1690168629,
  tx_count: 3721,
  merkle_root: "91f01a00530c8c83617190048ea8b0814d506cf24dfdbcf8893f8f0cab7f0855",
};

test("a Bitcoin block is attested from the header and summary, falling over after 403", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("mempool.space")) {
      return new Response("blocked", { status: 403 });
    }
    if (url.endsWith("/block-height/800000")) {
      return new Response(BITCOIN_HASH);
    }
    if (url.endsWith("/header")) {
      return new Response(BITCOIN_HEADER);
    }
    if (url.endsWith(`/block/${BITCOIN_HASH}`)) {
      return new Response(JSON.stringify(BITCOIN_INFO), { headers: { "content-type": "application/json" } });
    }
    return new Response("missing", { status: 404 });
  };

  const block = await fetchBitcoinBlock("800000", fetchImpl, {});
  assert.equal(block.blockHash, BITCOIN_HASH);
  assert.equal(block.height, "800000");
  assert.equal(block.txCount, 3721);
  assert.equal(block.txRoot, "55087fab0c8f3f89f8bcfd4df26c504d81b0a88e04907161838c0c53001af091");
  assert.ok(calls.some((url) => url.includes("blockstream.info")));
  assert.ok(calls.every((url) => !url.includes("/txids")));
});

test("a Bitcoin header mismatch is not retried on the next host", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("blockstream.info")) {
      throw new Error("fell through");
    }
    if (url.endsWith("/block-height/1")) {
      return new Response("aa".repeat(32));
    }
    if (url.endsWith("/header")) {
      return new Response("00".repeat(80));
    }
    return new Response("missing", { status: 404 });
  };

  await assert.rejects(() => fetchBitcoinBlock("1", fetchImpl, {}), /does not match/);
  assert.ok(calls.every((url) => url.includes("mempool.space")));
});

test("Algorand block fetch retries public hosts after 403 and leaves a private host alone", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("accept"), "application/msgpack");
    assert.equal(headers.get("X-Algo-API-Token"), "secret");
    return new Response("blocked", { status: 403 });
  };

  await assert.rejects(() => fetchAlgorandBlock("66049980", fetchImpl, { ALGOD_TOKEN: "secret" }), /403/);
  assert.ok(calls.length >= 2);
  assert.ok(calls.some((url) => url.startsWith("https://mainnet-api.algonode.network/v2/blocks/66049980?format=msgpack")));
  assert.ok(calls.every((url) => url.includes("format=msgpack")));

  calls.length = 0;
  await assert.rejects(
    () => fetchAlgorandBlock("1", fetchImpl, { ALGOD_URL: "http://127.0.0.1:9", ALGOD_TOKEN: "secret" }),
    /403 from http:\/\/127\.0\.0\.1:9\/v2\/blocks\/1\?format=msgpack/,
  );
  assert.deepEqual(calls, ["http://127.0.0.1:9/v2/blocks/1?format=msgpack"]);
});
