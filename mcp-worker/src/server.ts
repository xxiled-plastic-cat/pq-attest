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
        "pq_attest is paid at 0.001 USDC. Pay in Algorand, Base, or Solana USDC. The payment network is independent of the source chain.",
        "The first call returns PAYMENT_REQUIRED; retry with paymentSignature.",
        "Each paid call submits a new 0 ALGO attestation. This server does not sign or settle.",
        "pq_verify is free. It checks the ML-DSA-65 proof bundle. Pass chain=true to re-fetch the source and the Algorand attestation."
      ].join(" ")
    }
  );

  const chainEnum = z.enum([
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
    "stellar",
    "arbitrum",
    "optimism",
    "avalanche",
    "xrpl",
  ]);

  server.registerTool(
    "pq_attest_block",
    {
      description:
        "Attest one block via paid POST /attest-block (~0.001 USDC). height is that block's number.",
      inputSchema: {
        chain: chainEnum.describe("Source chain."),
        height: z.union([z.string(), z.number()]).describe("Block number."),
        blockHash: z.string().optional().describe("Optional hash that must match the fetched block."),
        paymentSignature: z.string().optional().describe("Optional PAYMENT-SIGNATURE. Omit for the x402 preflight."),
      },
    },
    async (args) => {
      const body = {
        chain: args.chain,
        height: args.height,
        ...(args.blockHash ? { blockHash: args.blockHash } : {}),
      };
      try {
        const result = await client.fetchPaid("/attest-block", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {}),
        });
        return paidToolResult(result, { path: "/attest-block", method: "POST", body });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "pq_prove_tx_inclusion",
    {
      description:
        "Prove a transaction is in a block via paid POST /prove-tx-inclusion. Refused when that chain has no inclusion proof.",
      inputSchema: {
        chain: chainEnum.describe("Source chain."),
        txId: z.string().describe("Transaction id."),
        height: z.union([z.string(), z.number()]).optional().describe("Block number when the chain cannot look it up."),
        paymentSignature: z.string().optional().describe("Optional PAYMENT-SIGNATURE. Omit for the x402 preflight."),
      },
    },
    async (args) => {
      const body = {
        chain: args.chain,
        txId: args.txId,
        ...(args.height != null ? { height: args.height } : {}),
      };
      try {
        const result = await client.fetchPaid("/prove-tx-inclusion", {
          method: "POST",
          body,
          ...(args.paymentSignature ? { paymentSignature: args.paymentSignature } : {}),
        });
        return paidToolResult(result, { path: "/prove-tx-inclusion", method: "POST", body });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "pq_verify_tx_inclusion",
    {
      description: "Verify a tx-inclusion-v1 proof via free POST /verify-tx-inclusion.",
      inputSchema: {
        proof: z.record(z.string(), z.unknown()).describe("Inclusion proof JSON."),
      },
    },
    async (args) => {
      try {
        const body = await client.fetchFree("/verify-tx-inclusion", { method: "POST", body: args.proof });
        return jsonResult(body);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "pq_attest",
    {
      description:
        "Attest a confirmed transaction via paid POST /attest (~0.001 USDC). Supported chains include Algorand, Base, Ethereum, Polygon, Arbitrum, Optimism, Avalanche, Solana, Bitcoin, Aptos, Sui, NEAR, TON, Hedera, Stellar, and XRPL. The attestation is recorded on Algorand. chain is required and the transaction id must match it. Omit paymentSignature for the x402 preflight, then retry with the same txid, chain, and paymentSignature. Pay in Algorand, Base, or Solana USDC. The payment network is independent of the source chain. Each paid call submits a new attestation. This server does not sign or hold attestor keys.",
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
            "stellar",
            "arbitrum",
            "optimism",
            "avalanche",
            "xrpl"
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
