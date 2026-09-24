import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils";
import type { ApiDeps } from "../src/server.ts";
import { handleHttp, startServer } from "../src/server.ts";
import type { ProofBundle, UnsignedBundle } from "../src/types.ts";
import {
  ATTEST_DESCRIPTION,
  BASE_ATTEST_DESCRIPTION,
  BASE_MAINNET,
  BASE_USDC_ASSET,
  FACILITATOR_ALGORAND_MAINNET,
  SOLANA_ATTEST_DESCRIPTION,
  SOLANA_MAINNET,
  SOLANA_USDC_ASSET,
} from "../src/x402.ts";

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

function signatureHeader(payTo = PAY_TO, extensions?: Record<string, unknown>): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      ...(extensions ? { extensions } : {}),
      accepted: {
        scheme: "exact",
        network: FACILITATOR_ALGORAND_MAINNET,
        asset: "31566704",
        amount: "1000",
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
    assert.equal(body.accepts[0]?.maxAmountRequired, "1000");
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
    const response = await post("/attest", JSON.stringify({ txid: TXID, chain: "algorand" }), api, PAY_ENV);
    assert.equal(response.status, 402);
    assert.deepEqual(calls, ["/supported"]);
    assert.equal(api.calls.attest.length, 0);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    const encoded = response.headers.get("payment-required");
    assert.ok(encoded);
    const required = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      x402Version: number;
      resource: { url: string; description: string; mimeType: string; serviceName: string; tags: string[]; iconUrl: string };
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
    assert.equal(required.resource.serviceName, "PQ Attest");
    assert.deepEqual(required.resource.tags, ["attestation", "algorand", "x402"]);
    assert.equal(required.resource.iconUrl, "https://pqattest.com/favicon.png");
    assert.match(required.resource.url, /\/attest$/);
    const accept = required.accepts[0];
    assert.ok(accept);
    assert.equal(accept.scheme, "exact");
    assert.equal(accept.network, FACILITATOR_ALGORAND_MAINNET);
    assert.equal(accept.asset, "31566704");
    assert.equal(accept.amount, "1000");
    assert.equal(accept.payTo, PAY_TO);
    assert.equal(accept.maxTimeoutSeconds, 60);
    assert.equal(accept.extra.feePayer, FEE_PAYER);
    const extensions = (required as { extensions?: { bazaar?: { info?: { input?: { method?: string; bodyType?: string; body?: { txid?: string; chain?: string } } } }; "x402-merchant"?: { info?: { name?: string; website?: string } } } }).extensions;
    assert.equal(extensions?.bazaar?.info?.input?.method, "POST");
    assert.equal(extensions?.bazaar?.info?.input?.bodyType, "json");
    assert.equal(extensions?.bazaar?.info?.input?.body?.chain, "algorand");
    assert.equal(extensions?.["x402-merchant"]?.info?.name, "PQ Attest");
    assert.equal(extensions?.["x402-merchant"]?.info?.website, "https://pqattest.com");
    assert.ok(encoded.length < 12_000);
  });

  it("forwards echoed bazaar extensions to verify and settle", async () => {
    const echoed = { bazaar: { info: { input: { type: "http", method: "POST" } } } };
    const bodies: { path: string; extensions: unknown }[] = [];
    const api = deps({
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/supported") {
          return supportedResponse();
        }
        const body = JSON.parse(String(init?.body)) as { paymentPayload?: { extensions?: unknown } };
        bodies.push({ path, extensions: body.paymentPayload?.extensions });
        if (path === "/verify") {
          return Response.json({ isValid: true });
        }
        return Response.json({ success: true, transaction: "SETTLED" });
      },
    });
    const response = await post("/attest", JSON.stringify({ txid: TXID, chain: "algorand" }), api, PAY_ENV, {
      "payment-signature": signatureHeader(PAY_TO, echoed),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(bodies, [
      { path: "/verify", extensions: echoed },
      { path: "/settle", extensions: echoed },
    ]);
  });

  it("serves free x402 discovery documents", async () => {
    const api = deps();
    const x402 = await handleHttp(new Request("http://127.0.0.1/.well-known/x402"), api, PAY_ENV);
    assert.equal(x402.status, 200);
    assert.match(x402.headers.get("content-type") ?? "", /application\/json/);
    const x402Body = (await x402.json()) as { name: string; resources: { method: string; payTo: string; amount: string }[] };
    assert.equal(x402Body.name, "PQ Attest");
    assert.equal(x402Body.resources[0]?.method, "POST");
    assert.equal(x402Body.resources[0]?.payTo, PAY_TO);
    assert.equal(x402Body.resources[0]?.amount, "1000");

    const manifest = await handleHttp(new Request("http://127.0.0.1/.well-known/x402.json"), api, PAY_ENV);
    const manifestBody = (await manifest.json()) as { mcpUrl: string; resources: { path: string }[] };
    assert.equal(manifestBody.mcpUrl, "https://mcp.pqattest.com/mcp");
    assert.equal(manifestBody.resources[0]?.path, "/attest");

    const card = await handleHttp(new Request("http://127.0.0.1/.well-known/agent-card.json"), api, PAY_ENV);
    const cardBody = (await card.json()) as { skills: { id: string }[] };
    assert.equal(cardBody.skills[0]?.id, "pq_attest");

    const agent = await handleHttp(new Request("http://127.0.0.1/.well-known/agent.json"), api, PAY_ENV);
    assert.deepEqual(await agent.json(), cardBody);

    const plugin = await handleHttp(new Request("http://127.0.0.1/.well-known/ai-plugin.json"), api, PAY_ENV);
    const pluginBody = (await plugin.json()) as { api: { url: string } };
    assert.equal(pluginBody.api.url, "http://127.0.0.1/openapi.json");

    const llms = await handleHttp(new Request("http://127.0.0.1/llms.txt"), api, PAY_ENV);
    assert.equal(llms.status, 200);
    assert.match(llms.headers.get("content-type") ?? "", /text\/plain/);
    const llmsBody = await llms.text();
    assert.match(llmsBody, /^# PQ Attest\n/);
    assert.match(llmsBody, new RegExp(PAY_TO));
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
    const response = await post("/attest", JSON.stringify({ txid: TXID, chain: "algorand" }), api, PAY_ENV, {
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
    const response = await post("/attest", JSON.stringify({ txid: TXID, chain: "algorand" }), api, PAY_ENV, {
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

  it("rejects an unrecognizable txid before asking for payment", async () => {
    const api = deps();
    const response = await post("/attest", JSON.stringify({ txid: "not-a-txid" }), api, PAY_ENV);
    assert.equal(response.status, 400);
    assert.equal(api.calls.attest.length, 0);
    assert.equal(response.headers.get("payment-required"), null);
  });

  it("advertises Algorand and Base USDC for a Base source and settles the selected rail", async () => {
    const BASE_TX = `0x${"ab".repeat(32)}`;
    const BASE_PAY_TO = "0x1111111111111111111111111111111111111111";
    const calls: string[] = [];
    const api = deps({
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push(`${url.hostname}${url.pathname}`);
        if (url.pathname === "/supported") {
          return Response.json({
            kinds: [
              { scheme: "exact", network: FACILITATOR_ALGORAND_MAINNET, extra: { feePayer: FEE_PAYER } },
              { scheme: "exact", network: BASE_MAINNET, extra: { name: "USD Coin", version: "2" } },
            ],
          });
        }
        const body = JSON.parse(String(init?.body)) as { paymentRequirements: { network: string } };
        if (url.pathname === "/verify") {
          return Response.json({ isValid: true });
        }
        assert.equal(body.paymentRequirements.network, BASE_MAINNET);
        return Response.json({ success: true, transaction: "BASE_SETTLED" });
      },
    });
    const unpaid = await post("/attest", JSON.stringify({ txid: BASE_TX, chain: "base" }), api, {
      ...PAY_ENV,
      X402_PAY_TO_BASE: BASE_PAY_TO,
    });
    assert.equal(unpaid.status, 402);
    const required = JSON.parse(Buffer.from(unpaid.headers.get("payment-required") ?? "", "base64").toString("utf8")) as {
      resource: { description: string };
      accepts: { network: string; asset: string; payTo: string; extra: { name?: string; feePayer?: string } }[];
    };
    assert.equal(required.resource.description, BASE_ATTEST_DESCRIPTION);
    assert.deepEqual(
      required.accepts.map((accept) => accept.network),
      [FACILITATOR_ALGORAND_MAINNET, BASE_MAINNET],
    );
    assert.equal(required.accepts[1]?.asset, BASE_USDC_ASSET);
    assert.equal(required.accepts[1]?.payTo, BASE_PAY_TO);
    assert.equal(required.accepts[1]?.extra.name, "USD Coin");

    const baseSignature = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: required.accepts[1],
        payload: { signature: "base" },
      }),
    ).toString("base64");
    const paid = await post("/attest", JSON.stringify({ txid: BASE_TX, chain: "base" }), api, {
      ...PAY_ENV,
      X402_PAY_TO_BASE: BASE_PAY_TO,
    }, { "payment-signature": baseSignature });
    assert.equal(paid.status, 200);
    assert.match(calls.join(","), /facilitator\.example\/settle/);
    const call = api.calls.attest.at(-1) as { txid: string; chain: string };
    assert.equal(call.txid, BASE_TX);
    assert.equal(call.chain, "base");
  });

  it("keeps an Algorand source on Algorand USDC when a Base payee is configured", async () => {
    const api = deps({
      fetch: facilitatorFetch({
        "/supported": supportedResponse,
      }),
    });
    const response = await post("/attest", JSON.stringify({ txid: TXID, chain: "algorand" }), api, {
      ...PAY_ENV,
      X402_PAY_TO_BASE: "0x1111111111111111111111111111111111111111",
    });
    assert.equal(response.status, 402);
    const required = JSON.parse(Buffer.from(response.headers.get("payment-required") ?? "", "base64").toString("utf8")) as {
      accepts: { network: string }[];
    };
    assert.deepEqual(
      required.accepts.map((accept) => accept.network),
      [FACILITATOR_ALGORAND_MAINNET],
    );
  });

  it("returns 500 for a Base source when neither payee is set", async () => {
    const api = deps();
    const response = await post("/attest", JSON.stringify({ txid: `0x${"ab".repeat(32)}`, chain: "base" }), api, {});
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /X402_PAY_TO or X402_PAY_TO_BASE/);
  });

  it("advertises Algorand and Solana USDC for a Solana source and settles the selected rail", async () => {
    const SOLANA_TX = "2".repeat(88);
    const SOLANA_PAY_TO = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";
    const SOLANA_FEE_PAYER = "EwWqGE4ZFKLofuestmU4LDdK7XM1N4ALgdZccwYugwGd";
    const calls: string[] = [];
    const api = deps({
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push(`${url.hostname}${url.pathname}`);
        if (url.pathname === "/supported") {
          return Response.json({
            kinds: [
              { scheme: "exact", network: FACILITATOR_ALGORAND_MAINNET, extra: { feePayer: FEE_PAYER } },
              { scheme: "exact", network: SOLANA_MAINNET, extra: { feePayer: SOLANA_FEE_PAYER } },
            ],
          });
        }
        const body = JSON.parse(String(init?.body)) as { paymentRequirements: { network: string } };
        if (url.pathname === "/verify") {
          return Response.json({ isValid: true });
        }
        assert.equal(body.paymentRequirements.network, SOLANA_MAINNET);
        return Response.json({ success: true, transaction: "SOLANA_SETTLED" });
      },
    });
    const solanaEnv = {
      ...PAY_ENV,
      X402_PAY_TO_SOLANA: SOLANA_PAY_TO,
    };
    const unpaid = await post("/attest", JSON.stringify({ txid: SOLANA_TX, chain: "solana" }), api, solanaEnv);
    assert.equal(unpaid.status, 402);
    const required = JSON.parse(Buffer.from(unpaid.headers.get("payment-required") ?? "", "base64").toString("utf8")) as {
      resource: { description: string };
      accepts: { network: string; asset: string; payTo: string; extra: { feePayer?: string } }[];
    };
    assert.equal(required.resource.description, SOLANA_ATTEST_DESCRIPTION);
    assert.deepEqual(
      required.accepts.map((accept) => accept.network),
      [FACILITATOR_ALGORAND_MAINNET, SOLANA_MAINNET],
    );
    assert.equal(required.accepts[1]?.asset, SOLANA_USDC_ASSET);
    assert.equal(required.accepts[1]?.payTo, SOLANA_PAY_TO);
    assert.equal(required.accepts[1]?.extra.feePayer, SOLANA_FEE_PAYER);

    const solanaSignature = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: required.accepts[1],
        payload: { transaction: "c29sYW5h" },
      }),
    ).toString("base64");
    const paid = await post(
      "/attest",
      JSON.stringify({ txid: SOLANA_TX, chain: "solana" }),
      api,
      solanaEnv,
      { "payment-signature": solanaSignature },
    );
    assert.equal(paid.status, 200);
    assert.match(calls.join(","), /facilitator\.example\/settle/);
    const call = api.calls.attest.at(-1) as { txid: string; chain: string };
    assert.equal(call.txid, SOLANA_TX);
    assert.equal(call.chain, "solana");
  });

  it("keeps an Algorand source on Algorand USDC when a Solana payee is configured", async () => {
    const api = deps({
      fetch: facilitatorFetch({
        "/supported": supportedResponse,
      }),
    });
    const response = await post("/attest", JSON.stringify({ txid: TXID, chain: "algorand" }), api, {
      ...PAY_ENV,
      X402_PAY_TO_SOLANA: "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4",
    });
    assert.equal(response.status, 402);
    const required = JSON.parse(Buffer.from(response.headers.get("payment-required") ?? "", "base64").toString("utf8")) as {
      accepts: { network: string }[];
    };
    assert.deepEqual(
      required.accepts.map((accept) => accept.network),
      [FACILITATOR_ALGORAND_MAINNET],
    );
  });

  it("returns 500 for a Solana source when neither payee is set", async () => {
    const api = deps();
    const response = await post("/attest", JSON.stringify({ txid: "2".repeat(88), chain: "solana" }), api, {});
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /X402_PAY_TO or X402_PAY_TO_SOLANA/);
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
    const response = await post("/attest", JSON.stringify({ txid: TXID, chain: "algorand" }), api, PAY_ENV, {
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
        body: JSON.stringify({ txid: TXID, chain: "algorand" }),
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
