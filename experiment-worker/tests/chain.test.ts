import assert from "node:assert/strict";
import test from "node:test";

import { createChainClients } from "../src/chain.js";

test("payment uses the algod and indexer objects created with the token", () => {
  const clients = createChainClients({
    algodUrl: "https://mainnet-api.algonode.network/",
    indexerUrl: "https://mainnet-idx.algonode.network/",
    algodToken: "algod-secret",
    indexerToken: "indexer-secret",
  });
  assert.equal(clients.algorand.client.algod, clients.algod);
  assert.equal(clients.algorand.client.indexer, clients.indexer);
});

test("algod and indexer requests send the token they were created with", async () => {
  const clients = createChainClients({
    algodUrl: "https://mainnet-api.algonode.network/",
    indexerUrl: "https://mainnet-idx.algonode.network/",
    algodToken: "algod-secret",
    indexerToken: "indexer-secret",
  });
  const seen: Array<{ url: string; algo: string | null; indexer: string | null }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      algo: headers.get("X-Algo-API-Token"),
      indexer: headers.get("X-Indexer-API-Token"),
    });
    return Response.json({ "current-round": 1, transactions: [] });
  };
  try {
    await clients.indexer.searchForTransactions({ limit: 1 }).catch(() => undefined);
    await clients.algod.healthCheck().catch(() => undefined);
  } finally {
    globalThis.fetch = original;
  }
  const indexerCall = seen.find((call) => call.url.includes("mainnet-idx"));
  const algodCall = seen.find((call) => call.url.includes("mainnet-api"));
  assert.equal(indexerCall?.indexer, "indexer-secret");
  assert.equal(algodCall?.algo, "algod-secret");
});
