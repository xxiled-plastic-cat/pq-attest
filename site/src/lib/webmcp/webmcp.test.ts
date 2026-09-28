import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { chains } from "../../data/chains";
import { WEBMCP_TOOL_NAMES, WEBMCP_TOOLS, getWebMcpTool } from "./catalog";
import { executePqAttestWebMcpToolValue } from "./execute";
import { isOriginIsolated } from "./model-context";
import { registerPqAttestWebMcpTools } from "./register";
import type { ModelContext } from "./types";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TXID = "OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA";

function encodePaymentRequired(amount = "1000"): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "algorand:mainnet",
          asset: "31566704",
          payTo: "PAYTO",
          maxAmountRequired: amount,
          priceUsdc: "0.001",
        },
      ],
    }),
    "utf8",
  ).toString("base64");
}

describe("catalog", () => {
  it("matches the remote MCP tool names", () => {
    expect(WEBMCP_TOOLS.map((tool) => tool.name)).toEqual([...WEBMCP_TOOL_NAMES]);
    expect(getWebMcpTool("pq_attest")?.access).toBe("paid");
    expect(getWebMcpTool("pq_verify")?.access).toBe("free");
    expect(getWebMcpTool("pq_attest")?.inputSchema.properties).toHaveProperty("paymentSignature");
    expect(getWebMcpTool("pq_attest")?.inputSchema.properties.chain).toMatchObject({
      enum: chains.map((chain) => chain.id),
    });
  });
});

describe("execute", () => {
  it("posts a proof bundle and chain=1 for pq_verify", async () => {
    const bundle = { version: 1, source: { txnId: TXID } };
    let method = "";
    let url = "";
    let body = "";
    const result = await executePqAttestWebMcpToolValue("pq_verify", { bundle, chain: true }, {
      apiBaseUrl: "https://api.example",
      fetchImpl: async (input, init) => {
        url = String(input);
        method = init?.method ?? "";
        body = String(init?.body);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    expect(method).toBe("POST");
    expect(url).toBe("https://api.example/verify?chain=1");
    expect(JSON.parse(body)).toEqual(bundle);
    expect(result).toEqual({ ok: true });
  });

  it("omits chain=1 when pq_verify is not asked to re-fetch", async () => {
    let url = "";
    await executePqAttestWebMcpToolValue(
      "pq_verify",
      { bundle: { version: 1 } },
      {
        apiBaseUrl: "https://api.example",
        fetchImpl: async (input) => {
          url = String(input);
          return new Response("{}", { status: 200 });
        },
      },
    );
    expect(url).toBe("https://api.example/verify");
  });

  it("maps a 402 from pq_attest to PAYMENT_REQUIRED", async () => {
    let seenSignature = "";
    let body = "";
    const result = await executePqAttestWebMcpToolValue(
      "pq_attest",
      { txid: TXID, chain: "algorand" },
      {
        apiBaseUrl: "https://api.example",
        fetchImpl: async (_input, init) => {
          const headers = init?.headers as Record<string, string>;
          seenSignature = headers["PAYMENT-SIGNATURE"] ?? "";
          body = String(init?.body);
          return new Response(JSON.stringify({ error: "Payment required" }), {
            status: 402,
            headers: { "payment-required": encodePaymentRequired() },
          });
        },
      },
    );

    expect(seenSignature).toBe("");
    expect(JSON.parse(body)).toEqual({ txid: TXID, chain: "algorand" });
    expect(result).toMatchObject({
      error: "PAYMENT_REQUIRED",
      message: "Sign PAYMENT-REQUIRED and retry this tool call with paymentSignature.",
      retry: { arg: "paymentSignature", header: "PAYMENT-SIGNATURE" },
      mcpPayment: { required: true, priceUsdc: "0.001" },
    });
  });

  it("forwards paymentSignature as PAYMENT-SIGNATURE and keeps it out of the body", async () => {
    let seenSignature = "";
    let body = "";
    const proof = { version: 1, source: { txnId: TXID } };
    const result = await executePqAttestWebMcpToolValue(
      "pq_attest",
      { txid: TXID, chain: "base", paymentSignature: "c2ln" },
      {
        apiBaseUrl: "https://api.example/",
        fetchImpl: async (input, init) => {
          expect(String(input)).toBe("https://api.example/attest");
          const headers = init?.headers as Record<string, string>;
          seenSignature = headers["PAYMENT-SIGNATURE"] ?? "";
          body = String(init?.body);
          return new Response(JSON.stringify(proof), {
            status: 200,
            headers: { "payment-response": "cmVjZWlwdA" },
          });
        },
      },
    );

    expect(seenSignature).toBe("c2ln");
    expect(JSON.parse(body)).toEqual({ txid: TXID, chain: "base" });
    expect(result).toMatchObject({
      ...proof,
      mcpPayment: { required: false, paymentResponsePresent: true },
    });
  });
});

describe("register", () => {
  it("registers both tools", async () => {
    const names: string[] = [];
    const modelContext: ModelContext = {
      async registerTool(tool) {
        names.push(tool.name);
        expect(tool.inputSchema.type).toBe("object");
        expect(typeof tool.execute).toBe("function");
      },
    };

    const status = await registerPqAttestWebMcpTools({
      apiBaseUrl: "https://api.example",
      modelContext,
    });

    expect(names).toEqual([...WEBMCP_TOOL_NAMES]);
    expect(status.registered).toEqual([...WEBMCP_TOOL_NAMES]);
    expect(status.failed).toEqual([]);
    expect(status.api).toBe("document.modelContext");
    expect(status.originIsolated).toBe(true);
    expect(isOriginIsolated()).toBe(true);
  });

  it("reports the API unavailable without throwing", async () => {
    const status = await registerPqAttestWebMcpTools({
      apiBaseUrl: "https://api.example",
      modelContext: null,
    });
    expect(status.api).toBe("unavailable");
    expect(status.registered).toEqual([]);
    expect(status.failed).toEqual([]);
  });
});

describe("page wiring", () => {
  it("keeps origin isolation and publishes the tools permission on /attest", () => {
    const files = [
      "src/lib/webmcp/model-context.ts",
      "src/lib/webmcp/register.ts",
      "src/lib/webmcp/execute.ts",
      "src/pages/attest.astro",
      "src/layouts/Base.astro",
    ];
    for (const relative of files) {
      const source = readFileSync(resolve(siteRoot, relative), "utf8");
      expect(source.includes("document.domain ="), false);
      expect(source.includes("document.domain="), false);
    }

    const attest = readFileSync(resolve(siteRoot, "src/pages/attest.astro"), "utf8");
    expect(attest).toContain("registerPqAttestWebMcpTools");
    expect(attest).toContain("webmcp");

    const headers = readFileSync(resolve(siteRoot, "public/_headers"), "utf8");
    expect(headers).toContain("/attest");
    expect(headers).toContain("Permissions-Policy: tools=(self), document-domain=()");
    expect(headers).toContain("Origin-Agent-Cluster: ?1");
  });
});
