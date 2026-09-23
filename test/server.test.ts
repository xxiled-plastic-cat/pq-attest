import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils";
import type { ApiDeps } from "../src/server.ts";
import { handleHttp, startServer } from "../src/server.ts";
import type { ProofBundle, UnsignedBundle } from "../src/types.ts";

const TXID = "OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA";

const bundle: ProofBundle = {
  version: 1,
  network: "algorand-mainnet",
  source: {
    txnId: TXID,
    hashSha256: "ab".repeat(32),
    txnBytesBase64: "e30=",
  },
  attest: {
    txnId: "ATTEST",
    round: 10,
    note: "attest:v1",
  },
  attestor: {
    algorandAddress: "ADDR",
    pqPublicKey: "cGs=",
  },
  signature: {
    alg: "ML-DSA-65",
    sigBase64: "c2ln",
  },
};

function deps(overrides: Partial<ApiDeps> = {}): ApiDeps & {
  calls: { attest: unknown[]; verify: unknown[] };
} {
  const calls = { attest: [] as unknown[], verify: [] as unknown[] };
  return {
    calls,
    createClient: () => ({}) as AlgorandClient,
    assertMainNet: async () => undefined,
    attest: async (input) => {
      calls.attest.push(input);
      return bundle;
    },
    verify: async (body, options) => {
      calls.verify.push({ body, options });
      return bundle as UnsignedBundle;
    },
    ...overrides,
  };
}

async function post(path: string, body: string, api: ApiDeps): Promise<Response> {
  return handleHttp(
    new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
    api,
    {},
  );
}

describe("HTTP API", () => {
  it("publishes attest as paid on the free discovery route", async () => {
    const api = deps();
    const response = await handleHttp(new Request("http://127.0.0.1/discovery"), api, {
      X402_PAY_TO: "PAYTO",
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      accepts: { maxAmountRequired: string }[];
      endpoints: { path: string; access: string }[];
    };
    assert.equal(body.accepts[0]?.maxAmountRequired, "100");
    assert.equal(body.endpoints.find((endpoint) => endpoint.path === "/attest")?.access, "paid");
    assert.equal(body.endpoints.find((endpoint) => endpoint.path === "/verify")?.access, "free");
  });

  it("returns health without calling attest", async () => {
    const api = deps();
    const response = await handleHttp(new Request("http://127.0.0.1/health"), api, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(api.calls.attest.length, 0);
  });

  it("rejects a bad attest txid before doing any work", async () => {
    const api = deps();
    const response = await post("/attest", JSON.stringify({ txid: "not-a-txid" }), api);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /txid/);
    assert.equal(api.calls.attest.length, 0);
  });

  it("returns the proof bundle for a valid txid", async () => {
    const api = deps();
    const response = await post("/attest", JSON.stringify({ txid: TXID }), api);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), bundle);
    const call = api.calls.attest[0] as { txid: string };
    assert.equal(call.txid, TXID);
  });

  it("maps a missing indexer transaction to 404", async () => {
    const api = deps({
      attest: async () => {
        throw new Error(`Indexer did not return transaction ${TXID}.`);
      },
    });
    const response = await post("/attest", JSON.stringify({ txid: TXID }), api);
    assert.equal(response.status, 404);
  });

  it("rejects an invalid verify bundle with 400", async () => {
    const api = deps({
      verify: async () => {
        throw new Error("Bundle must be a JSON object.");
      },
    });
    const response = await post("/verify", "{}", api);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /Bundle/);
  });

  it("verifies a bundle and passes chain=1 through", async () => {
    const api = deps();
    const response = await post(`/verify?chain=1`, JSON.stringify(bundle), api);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      chain: true,
      source: { txnId: TXID, hashSha256: bundle.source.hashSha256 },
    });
    const call = api.calls.verify[0] as { options: { chain?: boolean } };
    assert.equal(call.options.chain, true);
  });

  it("rejects a verify body over 2 MB", async () => {
    const api = deps();
    const response = await post("/verify", JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) }), api);
    assert.equal(response.status, 413);
    assert.equal(api.calls.verify.length, 0);
  });

  it("serves attest through the node HTTP server", async () => {
    const api = deps();
    const server = startServer(api, 0);
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txid: TXID }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), bundle);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("listens only on 127.0.0.1", async () => {
    const server = startServer(deps(), 0);
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
});
