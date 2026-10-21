import assert from "node:assert/strict";
import test from "node:test";

import type { AlgorandClient } from "@algorandfoundation/algokit-utils";

import { assertPriceCap, payForBitcoinBlock, payForBlock, selectAlgorandAccept } from "../src/pay.js";

const algorand = {} as AlgorandClient;

const ALGORAND = {
  scheme: "exact",
  network: "algorand:mainnet",
  asset: "31566704",
  amount: "1000",
  payTo: "PAYTO",
  maxTimeoutSeconds: 60,
  extra: { feePayer: "FEE" },
};

test("selects the Algorand accept and ignores other rails", () => {
  const selected = selectAlgorandAccept([
    { ...ALGORAND, network: "eip155:8453", amount: "1", asset: "0xbase" },
    ALGORAND,
  ]);
  assert.equal(selected.network, "algorand:mainnet");
  assert.throws(() => selectAlgorandAccept([{ ...ALGORAND, network: "eip155:8453" }]), /Algorand USDC/);
});

test("refuses an Algorand price above 1000 atomic units", () => {
  assert.doesNotThrow(() => assertPriceCap("1000"));
  assert.doesNotThrow(() => assertPriceCap("0"));
  assert.throws(() => assertPriceCap("1001"), /1000 atomic cap/);
  assert.throws(() => assertPriceCap("1.5"), /atomic amount/);
});

test("pays one Bitcoin block with the Algorand signature and stores the bundle", async () => {
  const calls: Array<{ url: string; signature: string | null; body: unknown }> = [];
  const paid = await payForBitcoinBlock({
    apiUrl: "https://api.pqattest.com/",
    algorand,
    mnemonic: "not-used",
    height: 98,
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        signature: headers.get("PAYMENT-SIGNATURE"),
        body: JSON.parse(String(init?.body)),
      });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: "Payment Required" }), {
          status: 402,
          headers: { "payment-required": encodeRequired("1000") },
        });
      }
      return Response.json(bundle(98));
    },
    createSignature: async () => "signed",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.signature, null);
  assert.equal(calls[1]?.signature, "signed");
  assert.deepEqual(calls[1]?.body, { chain: "bitcoin", height: "98" });
  assert.equal(paid.attestTxnId, "ATTXN");
  assert.equal(paid.paidAtomic, "1000");
  assert.equal(paid.blockHash, "cd".repeat(32));
});

test("pays one Ethereum block and refuses a Bitcoin bundle", async () => {
  const calls: unknown[] = [];
  const paid = await payForBlock({
    apiUrl: "https://api.pqattest.com/",
    algorand,
    mnemonic: "not-used",
    chain: "ethereum",
    height: 969,
    fetchImpl: async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)));
      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: "Payment Required" }), {
          status: 402,
          headers: { "payment-required": encodeRequired("1000") },
        });
      }
      return Response.json({ ...(bundle(969) as Record<string, unknown>), chain: "ethereum", height: "969" });
    },
    createSignature: async () => "signed",
  });
  assert.deepEqual(calls[1], { chain: "ethereum", height: "969" });
  assert.equal(paid.paidAtomic, "1000");

  let responded = 0;
  await assert.rejects(
    () =>
      payForBlock({
        apiUrl: "https://api.pqattest.com",
        algorand,
        mnemonic: "not-used",
        chain: "ethereum",
        height: 969,
        fetchImpl: async () => {
          responded += 1;
          if (responded === 1) {
            return new Response("", { status: 402, headers: { "payment-required": encodeRequired("1000") } });
          }
          return Response.json(bundle(969));
        },
        createSignature: async () => "signed",
      }),
    /Ethereum block bundle/,
  );
});

test("does not sign when the Algorand price is above the cap", async () => {
  let signed = false;
  await assert.rejects(
    () =>
      payForBitcoinBlock({
        apiUrl: "https://api.pqattest.com",
        algorand,
        mnemonic: "not-used",
        height: 98,
        fetchImpl: async () =>
          new Response("", { status: 402, headers: { "payment-required": encodeRequired("1001") } }),
        createSignature: async () => {
          signed = true;
          return "signed";
        },
      }),
    /1000 atomic cap/,
  );
  assert.equal(signed, false);
});

test("does not sign when Algorand is not offered", async () => {
  await assert.rejects(
    () =>
      payForBitcoinBlock({
        apiUrl: "https://api.pqattest.com",
        algorand,
        mnemonic: "not-used",
        height: 98,
        fetchImpl: async () =>
          new Response("", {
            status: 402,
            headers: { "payment-required": encodeRequired("1000", "eip155:8453") },
          }),
        createSignature: async () => "signed",
      }),
    /Algorand USDC/,
  );
});

function encodeRequired(amount: string, network = "algorand:mainnet"): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      x402Version: 2,
      error: "Payment Required",
      resource: { url: "https://api.pqattest.com/attest-block", description: "block", mimeType: "application/json" },
      accepts: [{ ...ALGORAND, amount, network }],
      extensions: {},
    }),
  );
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function bundle(height: number): unknown {
  return {
    schema: "block-attest-v1",
    chain: "bitcoin",
    height: String(height),
    blockHash: "cd".repeat(32),
    anchor: { txnId: "ATTXN", round: 1, note: "block-attest:v1:bitcoin:98:cd" },
  };
}
