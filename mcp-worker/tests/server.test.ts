import assert from "node:assert/strict";
import test from "node:test";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import worker from "../src/index.js";
import { createPqAttestMcpServer } from "../src/server.js";

const TXID = "OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA";

const CONFIG = {
  apiUrl: "https://api.pqattest.com",
  publicUrl: "https://mcp.example/mcp"
};

type RegisteredTool = {
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
};

function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

function encodePaymentRequired(): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "algorand-mainnet",
          asset: "31566704",
          payTo: "PAYTO",
          maxAmountRequired: "100",
          priceUsdc: "0.0001"
        }
      ]
    }),
    "utf8"
  ).toString("base64");
}

test("GET /mcp returns 405 Allow POST, DELETE", async () => {
  const response = await worker.fetch(new Request("https://worker.test/mcp", { method: "GET" }), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "POST, DELETE");
  assert.equal(await response.text(), "");
});

test("GET /.well-known/mcp.json describes the paid and free tools", async () => {
  const response = await worker.fetch(new Request("https://worker.test/.well-known/mcp.json", { method: "GET" }), {});
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    description: string;
    transport: string;
    url: string;
    tools: { name: string }[];
  };
  assert.match(body.description, /pq_attest/);
  assert.equal(body.transport, "streamable-http");
  assert.equal(body.url, "https://worker.test/mcp");
  assert.deepEqual(
    body.tools.map((tool) => tool.name),
    ["pq_attest", "pq_verify"]
  );

  const alias = await worker.fetch(new Request("https://worker.test/.well-known/mcp", { method: "GET" }), {});
  assert.deepEqual(await alias.json(), body);
});

test("GET /health is not a 405", async () => {
  const health = await worker.fetch(new Request("https://worker.test/health", { method: "GET" }), {});
  assert.equal(health.status, 200);
  const body = (await health.json()) as { ok: boolean; transport: string; apiUrl: string };
  assert.equal(body.ok, true);
  assert.equal(body.transport, "streamable-http");
  assert.equal(body.apiUrl, "https://api.pqattest.com");
});

test("pq_attest without a signature surfaces PAYMENT_REQUIRED and does not send PAYMENT-SIGNATURE", async () => {
  let paymentSignature: string | undefined;
  const server = createPqAttestMcpServer({
    config: CONFIG,
    fetchImpl: async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/attest");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string> | undefined;
      paymentSignature = headers?.["PAYMENT-SIGNATURE"];
      assert.deepEqual(JSON.parse(String(init?.body)), { txid: TXID });
      return new Response(JSON.stringify({ error: "Payment Required" }), {
        status: 402,
        headers: { "payment-required": encodePaymentRequired() }
      });
    }
  });

  const result = await registeredTools(server).pq_attest!.handler({ txid: TXID }, {});
  assert.equal(paymentSignature, undefined);
  assert.equal(result.isError, undefined);
  const payload = JSON.parse(result.content[0]!.text ?? "") as {
    error: string;
    mcpPayment: { paymentRequiredHeader: string; priceUsdc: string };
    retry: { arg: string };
  };
  assert.equal(payload.error, "PAYMENT_REQUIRED");
  assert.equal(payload.mcpPayment.priceUsdc, "0.0001");
  assert.ok(payload.mcpPayment.paymentRequiredHeader);
  assert.equal(payload.retry.arg, "paymentSignature");
});

test("pq_attest forwards paymentSignature and returns the bundle", async () => {
  let paymentSignature = "";
  const bundle = { version: 1, network: "algorand-mainnet", source: { txnId: TXID } };
  const server = createPqAttestMcpServer({
    config: CONFIG,
    fetchImpl: async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      paymentSignature = headers["PAYMENT-SIGNATURE"] ?? "";
      return new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { "payment-response": "receipt" }
      });
    }
  });

  const result = await registeredTools(server).pq_attest!.handler(
    { txid: TXID, paymentSignature: "signed-payload" },
    {}
  );
  assert.equal(paymentSignature, "signed-payload");
  const payload = JSON.parse(result.content[0]!.text ?? "") as {
    version: number;
    mcpPayment: { required: boolean; paymentResponseHeader: string };
  };
  assert.equal(payload.version, 1);
  assert.equal(payload.mcpPayment.required, false);
  assert.equal(payload.mcpPayment.paymentResponseHeader, "receipt");
});

test("pq_verify posts the bundle and sets chain=1 only when asked", async () => {
  const calls: string[] = [];
  const bundle = { version: 1, signature: { alg: "ML-DSA-65" } };
  const server = createPqAttestMcpServer({
    config: CONFIG,
    fetchImpl: async (input, init) => {
      calls.push(`${init?.method} ${String(input)}`);
      assert.deepEqual(JSON.parse(String(init?.body)), bundle);
      return new Response(JSON.stringify({ ok: true, chain: new URL(String(input)).searchParams.get("chain") === "1" }), {
        status: 200
      });
    }
  });

  const tools = registeredTools(server);
  const offline = await tools.pq_verify!.handler({ bundle }, {});
  const online = await tools.pq_verify!.handler({ bundle, chain: true }, {});

  assert.deepEqual(calls, [
    "POST https://api.pqattest.com/verify",
    "POST https://api.pqattest.com/verify?chain=1"
  ]);
  assert.deepEqual(JSON.parse(offline.content[0]!.text ?? ""), { ok: true, chain: false });
  assert.deepEqual(JSON.parse(online.content[0]!.text ?? ""), { ok: true, chain: true });
});
