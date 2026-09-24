import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ApiClient, type FetchFn } from "./client.js";
import type { WorkerConfig } from "./config.js";
import { errorResult, jsonResult, paidToolResult } from "./tool-result.js";

const TXID = /^[A-Za-z0-9+/=_@.-]{32,128}$/;

export interface CreateWorkerServerOptions {
  config: WorkerConfig;
  fetchImpl?: FetchFn;
}

export function createPqAttestMcpServer(options: CreateWorkerServerOptions): McpServer {
  const client = new ApiClient({ apiUrl: options.config.apiUrl }, options.fetchImpl);

  const server = new McpServer(
    {
      name: "pq-attest",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      },
      instructions: [
        "Remote pq-attest MCP server. Attestations are recorded on Algorand MainNet.",
        `API URL: ${options.config.apiUrl}.`,
        "pq_attest is paid at 0.001 USDC. Sources other than Base are paid in Algorand USDC. A Base source can be paid in Base USDC or Algorand USDC.",
        "The first call returns PAYMENT_REQUIRED; retry with paymentSignature.",
        "Each paid call submits a new 0 ALGO attestation. This server does not sign or settle.",
        "pq_verify is free. It checks the ML-DSA-65 proof bundle. Pass chain=true to re-fetch the source and the Algorand attestation."
      ].join(" ")
    }
  );

  server.registerTool(
    "pq_attest",
    {
      description:
        "Attest a confirmed transaction via paid POST /attest (~0.001 USDC). Supported chains include Algorand, Base, Ethereum, Polygon, Solana, Bitcoin, Aptos, Sui, NEAR, TON, Hedera, and Stellar. The attestation is recorded on Algorand. chain is required and the transaction id must match it. Omit paymentSignature for the x402 preflight, then retry with the same txid, chain, and paymentSignature. Sources other than Base are paid in Algorand USDC. A Base source can be paid in Base USDC or Algorand USDC. Each paid call submits a new attestation. This server does not sign or hold attestor keys.",
      inputSchema: {
        txid: z.string().regex(TXID, "txid must be a transaction id"),
        chain: z
          .enum([
            "algorand",
            "base",
            "ethereum",
            "polygon",
            "solana",
            "bitcoin",
            "aptos",
            "sui",
            "near",
            "ton",
            "hedera",
            "stellar"
          ])
          .describe("Source chain. Required. The transaction id must match this chain."),
        paymentSignature: z
          .string()
          .optional()
          .describe(
            "Optional PAYMENT-SIGNATURE base64 payload. Omit on first call to receive PAYMENT-REQUIRED metadata."
          )
      }
    },
    async (args) => {
      const body = { txid: args.txid, chain: args.chain };
      try {
        const result = await client.fetchPaid("/attest", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {})
        });
        return paidToolResult(result, { path: "/attest", method: "POST", body });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "pq_verify",
    {
      description:
        "Verify an ML-DSA-65 proof bundle via free POST /verify. Pass chain=true to re-fetch the source and the Algorand attestation.",
      inputSchema: {
        bundle: z.record(z.string(), z.unknown()).describe("Proof bundle JSON returned by pq_attest."),
        chain: z
          .boolean()
          .optional()
          .describe("When true, the API re-fetches both transactions from MainNet (?chain=1).")
      }
    },
    async (args) => {
      try {
        const body = await client.fetchFree("/verify", {
          method: "POST",
          body: args.bundle,
          ...(args.chain ? { query: { chain: "1" } } : {})
        });
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerResource(
    "discovery",
    "pq-attest://discovery",
    {
      description: "Live pq-attest discovery document (GET /discovery): free and paid routes and x402 terms.",
      mimeType: "application/json"
    },
    async (uri) => {
      const body = await client.fetchFree("/discovery");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2)
          }
        ]
      };
    }
  );

  return server;
}
