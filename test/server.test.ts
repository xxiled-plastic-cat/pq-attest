import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils";
import type { ApiDeps } from "../src/server.ts";
import { handleHttp, startServer } from "../src/server.ts";
import type { ProofBundle, UnsignedBundle } from "../src/types.ts";
import { ATTEST_DESCRIPTION, FACILITATOR_ALGORAND_MAINNET } from "../src/x402.ts";

const TXID = "OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA";
const PAY_TO = "YL63PQ3U4SHJXPBXJZJPNWKLUZ2DYQSJZ36OLWXGF7FOHWPYN4BELUOUPM";
const FEE_PAYER = "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA";
const PAY_ENV = { X402_PAY_TO: PAY_TO, FACILITATOR_URL: "https://facilitator.example" };

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

function supportedResponse(): Response {
  return Response.json({
    kinds: [
      {
        scheme: "exact",
        network: FACILITATOR_ALGORAND_MAINNET,
        extra: { feePayer: FEE_PAYER },
      },
    ],
  });
}

function facilitatorFetch(handlers: Record<string, () => Response>): ApiDeps["fetch"] {
  return async (input) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const handler = handlers[path];
    if (!handler) {
      throw new Error(`Unexpected facilitator call ${url}`);
    }
    return handler();
  };
}

function signatureHeader(payTo = PAY_TO): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: FACILITATOR_ALGORAND_MAINNET,
        asset: "31566704",
        amount: "100",
        payTo,
        maxTimeoutSeconds: 60,
        extra: { feePayer: FEE_PAYER },
      },
      payload: { signature: "test" },
    }),
  ).toString("base64");
}

async function post(
  path: string,
  body: string,
  api: ApiDeps,
  env: NodeJS.ProcessEnv = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return handleHttp(
    new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
    api,
    env,
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

  it("returns 402 with payment terms and does not attest", async () => {
    const calls: string[] = [];
    const api = deps({
      fetch: async (input) => {
        const url = String(input);
        calls.push(new URL(url).pathname);
        assert.equal(new URL(url).pathname, "/supported");
        return supportedResponse();
      },
    });
    const response = await post("/attest", JSON.stringify({ txid: "not-a-txid" }), api, PAY_ENV);
    assert.equal(response.status, 402);
    assert.deepEqual(calls, ["/supported"]);
    assert.equal(api.calls.attest.length, 0);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    const encoded = response.headers.get("payment-required");
    assert.ok(encoded);
    const required = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      x402Version: number;
      resource: { url: string; description: string; mimeType: string };
      accepts: {
        scheme: string;
        network: string;
        asset: string;
        amount: string;
        payTo: string;
        maxTimeoutSeconds: number;
        extra: { feePayer: string };
      }[];
    };
    assert.equal(required.x402Version, 2);
    assert.equal(required.resource.description, ATTEST_DESCRIPTION);
    assert.equal(required.resource.mimeType, "application/json");
    assert.match(required.resource.url, /\/attest$/);
    const accept = required.accepts[0];
    assert.ok(accept);
    assert.equal(accept.scheme, "exact");
    assert.equal(accept.network, FACILITATOR_ALGORAND_MAINNET);
    assert.equal(accept.asset, "31566704");
    assert.equal(accept.amount, "100");
    assert.equal(accept.payTo, PAY_TO);
    assert.equal(accept.maxTimeoutSeconds, 60);
    assert.equal(accept.extra.feePayer, FEE_PAYER);
  });

  it("does not settle when attest fails after a valid verify", async () => {
    const calls: string[] = [];
    const api = deps({
      attest: async () => {
        throw new Error(`Indexer did not return transaction ${TXID}.`);
      },
      fetch: facilitatorFetch({
        "/supported": supportedResponse,
        "/verify": () => {
          calls.push("/verify");
          return Response.json({ isValid: true });
        },
        "/settle": () => {
          calls.push("/settle");
          return Response.json({ success: true });
        },
      }),
    });
    const response = await post("/attest", JSON.stringify({ txid: TXID }), api, PAY_ENV, {
      "payment-signature": signatureHeader(),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(calls, ["/verify"]);
  });

  it("returns the proof bundle and a settlement receipt after payment", async () => {
    const api = deps({
      fetch: facilitatorFetch({
        "/supported": supportedResponse,
        "/verify": () => Response.json({ isValid: true }),
        "/settle": () => Response.json({ success: true, transaction: "SETTLED" }),
      }),
    });
    const response = await post("/attest", JSON.stringify({ txid: TXID }), api, PAY_ENV, {
      "payment-signature": signatureHeader(),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), bundle);
    const receipt = response.headers.get("payment-response");
    assert.ok(receipt);
    assert.deepEqual(JSON.parse(Buffer.from(receipt, "base64").toString("utf8")), {
      success: true,
      transaction: "SETTLED",
    });
    const call = api.calls.attest[0] as { txid: string };
    assert.equal(call.txid, TXID);
  });

  it("rejects a payment whose payTo does not match and does not attest", async () => {
    const api = deps({
      fetch: facilitatorFetch({
        "/supported": supportedResponse,
        "/verify": () => {
          throw new Error("verify should not be called");
        },
      }),
    });
    const response = await post("/attest", JSON.stringify({ txid: TXID }), api, PAY_ENV, {
      "payment-signature": signatureHeader("OTHER"),
    });
    assert.equal(response.status, 402);
    assert.equal(api.calls.attest.length, 0);
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

  it("serves unpaid attest as 402 through the node HTTP server", async () => {
    const previousPayTo = process.env.X402_PAY_TO;
    const previousFacilitator = process.env.FACILITATOR_URL;
    process.env.X402_PAY_TO = PAY_TO;
    process.env.FACILITATOR_URL = "https://facilitator.example";
    const api = deps({
      fetch: facilitatorFetch({
        "/supported": supportedResponse,
      }),
    });
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
      assert.equal(response.status, 402);
      assert.ok(response.headers.get("payment-required"));
      assert.equal(api.calls.attest.length, 0);
    } finally {
      if (previousPayTo === undefined) {
        delete process.env.X402_PAY_TO;
      } else {
        process.env.X402_PAY_TO = previousPayTo;
      }
      if (previousFacilitator === undefined) {
        delete process.env.FACILITATOR_URL;
      } else {
        process.env.FACILITATOR_URL = previousFacilitator;
      }
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
