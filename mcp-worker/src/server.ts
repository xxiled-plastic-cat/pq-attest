import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ApiClient, type FetchFn } from "./client.js";
import type { WorkerConfig } from "./config.js";
import { errorResult, jsonResult, paidToolResult } from "./tool-result.js";

const TXID = /^[A-Z2-7]{52}$/;

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
        "Remote pq-attest MCP server for Algorand MainNet transaction attestation.",
        `API URL: ${options.config.apiUrl}.`,
        "pq_attest is paid at 0.0001 USDC. The first call returns PAYMENT_REQUIRED; retry with paymentSignature.",
        "Each paid call submits a new 0 ALGO attestation. This server does not sign or settle.",
        "pq_verify is free. It checks the ML-DSA-65 proof bundle. Pass chain=true to re-fetch both transactions from MainNet."
      ].join(" ")
    }
  );

  server.registerTool(
    "pq_attest",
    {
      description:
        "Attest a confirmed Algorand MainNet transaction via paid POST /attest (~0.0001 USDC). Omit paymentSignature for the x402 preflight, then retry with the same txid and paymentSignature. Each paid call submits a new attestation. This server does not sign or hold attestor keys.",
      inputSchema: {
        txid: z.string().regex(TXID, "txid must be a 52-character Algorand transaction id"),
        paymentSignature: z
          .string()
          .optional()
          .describe(
            "Optional PAYMENT-SIGNATURE base64 payload. Omit on first call to receive PAYMENT-REQUIRED metadata."
          )
      }
    },
    async (args) => {
      const body = { txid: args.txid };
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
        "Verify an ML-DSA-65 proof bundle via free POST /verify. Pass chain=true to re-fetch the source and attest transactions from MainNet indexer.",
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
