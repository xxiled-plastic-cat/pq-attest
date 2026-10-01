import { chains } from "../../data/chains";
import type { WebMcpToolSpec } from "./types";

const CHAIN_IDS = chains.map((chain) => chain.id);

const TXID_PATTERN = "^[A-Za-z0-9+/=_@.-]{32,128}$";

const readOnly = {
  readOnlyHint: true,
  untrustedContentHint: true,
} as const;

const mutating = {
  readOnlyHint: false,
  untrustedContentHint: true,
} as const;

/**
 * Names and fields stay in lockstep with the remote MCP tools `pq_attest`
 * and `pq_verify`.
 */
export const WEBMCP_TOOL_NAMES = [
  "pq_attest",
  "pq_verify",
  "pq_attest_block",
  "pq_prove_tx_inclusion",
  "pq_verify_tx_inclusion",
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

export const WEBMCP_TOOLS: WebMcpToolSpec[] = [
  {
    name: "pq_attest",
    description:
      "Attest a confirmed transaction via paid POST /attest (~0.001 USDC). Supported chains include Algorand, Base, Ethereum, Polygon, Arbitrum, Optimism, Avalanche, Solana, Bitcoin, Aptos, Sui, NEAR, TON, Hedera, Stellar, and XRPL. The attestation is recorded on Algorand. chain is required and the transaction id must match it. Omit paymentSignature for the x402 preflight, then retry with the same txid, chain, and paymentSignature. Pay in Algorand, Base, or Solana USDC. The payment network is independent of the source chain. Each paid call submits a new attestation. This page does not sign or hold attestor keys.",
    inputSchema: {
      type: "object",
      properties: {
        txid: {
          type: "string",
          pattern: TXID_PATTERN,
          description: "Transaction id.",
        },
        chain: {
          type: "string",
          enum: [...CHAIN_IDS],
          description: "Source chain. Required. The transaction id must match this chain.",
        },
        paymentSignature: {
          type: "string",
          description:
            "Optional PAYMENT-SIGNATURE base64 payload. Omit on first call to receive PAYMENT-REQUIRED metadata.",
        },
      },
      required: ["txid", "chain"],
      additionalProperties: false,
    },
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.001",
    http: { method: "POST", path: "/attest" },
  },
  {
    name: "pq_verify",
    description:
      "Verify an ML-DSA-65 proof bundle via free POST /verify. Pass chain=true to re-fetch the source and the Algorand attestation.",
    inputSchema: {
      type: "object",
      properties: {
        bundle: {
          type: "object",
          additionalProperties: true,
          description: "Proof bundle JSON returned by pq_attest.",
        },
        chain: {
          type: "boolean",
          description: "When true, the API re-fetches both transactions from MainNet (?chain=1).",
        },
      },
      required: ["bundle"],
      additionalProperties: false,
    },
    annotations: readOnly,
    access: "free",
    http: { method: "POST", path: "/verify", queryParams: ["chain"] },
  },
  {
    name: "pq_attest_block",
    description:
      "Attest one block via paid POST /attest-block (~0.001 USDC). height is that block's number. The caller keeps the bundle.",
    inputSchema: {
      type: "object",
      properties: {
        chain: { type: "string", enum: [...CHAIN_IDS], description: "Source chain." },
        height: { description: "Block number." },
        blockHash: { type: "string", description: "Optional hash that must match the fetched block." },
        paymentSignature: { type: "string", description: "Optional PAYMENT-SIGNATURE. Omit for the x402 preflight." },
      },
      required: ["chain", "height"],
      additionalProperties: false,
    },
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.001",
    http: { method: "POST", path: "/attest-block" },
  },
  {
    name: "pq_prove_tx_inclusion",
    description:
      "Prove a transaction is in a block via paid POST /prove-tx-inclusion. Refused when the chain has no inclusion proof.",
    inputSchema: {
      type: "object",
      properties: {
        chain: { type: "string", enum: [...CHAIN_IDS], description: "Source chain." },
        txId: { type: "string", description: "Transaction id." },
        height: { description: "Block number, when the chain cannot find it from the transaction id." },
        paymentSignature: { type: "string", description: "Optional PAYMENT-SIGNATURE. Omit for the x402 preflight." },
      },
      required: ["chain", "txId"],
      additionalProperties: false,
    },
    annotations: mutating,
    access: "paid",
    fallbackPriceUsdc: "0.001",
    http: { method: "POST", path: "/prove-tx-inclusion" },
  },
  {
    name: "pq_verify_tx_inclusion",
    description: "Verify a tx-inclusion-v1 proof via free POST /verify-tx-inclusion.",
    inputSchema: {
      type: "object",
      properties: {
        proof: { type: "object", additionalProperties: true, description: "Inclusion proof JSON." },
      },
      required: ["proof"],
      additionalProperties: false,
    },
    annotations: readOnly,
    access: "free",
    http: { method: "POST", path: "/verify-tx-inclusion" },
  },
];

const toolsByName = new Map(WEBMCP_TOOLS.map((tool) => [tool.name, tool]));

export function getWebMcpTool(name: string): WebMcpToolSpec | undefined {
  return toolsByName.get(name);
}
