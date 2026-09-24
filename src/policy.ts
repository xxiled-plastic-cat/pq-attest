import { SOURCE_CHAINS } from "./source.ts";

export const DEFAULT_FACILITATOR_URL = "https://facilitator.goplausible.xyz";
export const DEFAULT_ATTEST_PRICE_USDC = "0.001";
export const DEFAULT_NETWORK = "algorand-mainnet";
export const DEFAULT_SCHEME = "exact";
export const USDC_ASSET_ID = "31566704";
export const BASE_USDC_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_NETWORK = "eip155:8453";
export const SOLANA_USDC_ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const USDC_DECIMALS = 6;
export const PAYMENT_HEADERS = ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"] as const;

export type EndpointAccess = "free" | "paid";

export interface EndpointPolicy {
  id: string;
  method: "GET" | "POST";
  path: string;
  access: EndpointAccess;
  summary: string;
  description: string;
}

export const endpointPolicies: readonly EndpointPolicy[] = [
  {
    id: "health",
    method: "GET",
    path: "/health",
    access: "free",
    summary: "Process health check",
    description: "Returns ok when the API process is up. No payment.",
  },
  {
    id: "ready",
    method: "GET",
    path: "/ready",
    access: "free",
    summary: "MainNet readiness check",
    description: "Returns ok when the API can reach Algorand MainNet. No payment.",
  },
  {
    id: "discovery",
    method: "GET",
    path: "/discovery",
    access: "free",
    summary: "Machine-readable endpoint catalog",
    description: "Lists free and paid routes and the x402 payment terms for POST /attest. No payment.",
  },
  {
    id: "openapi",
    method: "GET",
    path: "/openapi.json",
    access: "free",
    summary: "OpenAPI contract",
    description: "OpenAPI document for the attest and verify HTTP API. No payment.",
  },
  {
    id: "wellKnownX402",
    method: "GET",
    path: "/.well-known/x402",
    access: "free",
    summary: "x402 discovery document",
    description: "Paid resource, price, and network for POST /attest. No payment.",
  },
  {
    id: "wellKnownX402Json",
    method: "GET",
    path: "/.well-known/x402.json",
    access: "free",
    summary: "x402 service manifest",
    description: "Service manifest with OpenAPI, discovery, llms.txt, and MCP links. No payment.",
  },
  {
    id: "agentCard",
    method: "GET",
    path: "/.well-known/agent-card.json",
    access: "free",
    summary: "A2A agent card",
    description: "Agent card for the pq_attest skill. No payment.",
  },
  {
    id: "agentJson",
    method: "GET",
    path: "/.well-known/agent.json",
    access: "free",
    summary: "Agent manifest",
    description: "Same agent card as /.well-known/agent-card.json. No payment.",
  },
  {
    id: "aiPlugin",
    method: "GET",
    path: "/.well-known/ai-plugin.json",
    access: "free",
    summary: "AI plugin manifest",
    description: "Plugin manifest pointing at this origin's OpenAPI document. No payment.",
  },
  {
    id: "llmsTxt",
    method: "GET",
    path: "/llms.txt",
    access: "free",
    summary: "LLM index",
    description: "Plain-text index of the paid attest route and how to pay. No payment.",
  },
  {
    id: "verify",
    method: "POST",
    path: "/verify",
    access: "free",
    summary: "Verify an attestation bundle",
    description:
      "Checks the ML-DSA-65 signature and the hash preimage. Pass chain=1 to re-fetch the source and attest transactions from MainNet indexer. No payment.",
  },
  {
    id: "attest",
    method: "POST",
    path: "/attest",
    access: "paid",
    summary: "Attest a confirmed MainNet transaction",
    description:
      "Fetches a confirmed transaction from a supported chain, submits a 0 ALGO attestation note from the Falcon attestor, and returns an ML-DSA-65 proof bundle. " +
      "The attestation is always recorded on Algorand MainNet. " +
      "The first call returns 402 with PAYMENT-REQUIRED. Sources other than Base and Solana are paid in Algorand USDC. " +
      "A Base source can be paid in Base USDC or Algorand USDC when that rail is configured. " +
      "A Solana source can be paid in Solana USDC or Algorand USDC when that rail is configured. " +
      "Sign one advertised option and retry with PAYMENT-SIGNATURE. " +
      "Success may include PAYMENT-RESPONSE. Each paid call submits a new attestation transaction.",
  },
];

export interface PaymentConfig {
  priceUsdc: string;
  maxAmountRequired: string;
  payTo: string;
  payToBase: string;
  payToSolana: string;
  network: string;
  scheme: string;
  facilitatorUrl: string;
  asset: string;
  baseAsset: string;
  solanaAsset: string;
}

export function microUsdc(priceUsdc: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(priceUsdc.trim());
  if (!match) {
    throw new Error(`X402 price must be a USDC decimal amount, got ${priceUsdc}.`);
  }
  const fraction = match[2] ?? "";
  if (fraction.length > USDC_DECIMALS) {
    throw new Error(`X402 price supports at most ${USDC_DECIMALS} decimal places.`);
  }
  const micro = BigInt(match[1]) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  return micro.toString();
}

function envString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value ? value : fallback;
}

export function loadPaymentConfig(env: NodeJS.ProcessEnv): PaymentConfig {
  const priceUsdc = envString(env, "X402_PRICE_ATTEST_USDC", DEFAULT_ATTEST_PRICE_USDC);
  return {
    priceUsdc,
    maxAmountRequired: microUsdc(priceUsdc),
    payTo: env.X402_PAY_TO?.trim() ?? "",
    payToBase: env.X402_PAY_TO_BASE?.trim() ?? "",
    payToSolana: env.X402_PAY_TO_SOLANA?.trim() ?? "",
    network: envString(env, "X402_NETWORK", DEFAULT_NETWORK),
    scheme: envString(env, "X402_SCHEME", DEFAULT_SCHEME),
    facilitatorUrl: envString(env, "FACILITATOR_URL", DEFAULT_FACILITATOR_URL),
    asset: USDC_ASSET_ID,
    baseAsset: BASE_USDC_ASSET,
    solanaAsset: SOLANA_USDC_ASSET,
  };
}

export interface DiscoveryAccept {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  priceUsdc: string;
  facilitatorUrl: string;
}

export function discoveryAccepts(config: PaymentConfig): DiscoveryAccept[] {
  const accepts: DiscoveryAccept[] = [];
  if (config.payTo) {
    accepts.push({
      scheme: config.scheme,
      network: config.network,
      asset: config.asset,
      payTo: config.payTo,
      maxAmountRequired: config.maxAmountRequired,
      priceUsdc: config.priceUsdc,
      facilitatorUrl: config.facilitatorUrl,
    });
  }
  if (config.payToBase) {
    accepts.push({
      scheme: config.scheme,
      network: BASE_NETWORK,
      asset: config.baseAsset,
      payTo: config.payToBase,
      maxAmountRequired: config.maxAmountRequired,
      priceUsdc: config.priceUsdc,
      facilitatorUrl: config.facilitatorUrl,
    });
  }
  if (config.payToSolana) {
    accepts.push({
      scheme: config.scheme,
      network: SOLANA_NETWORK,
      asset: config.solanaAsset,
      payTo: config.payToSolana,
      maxAmountRequired: config.maxAmountRequired,
      priceUsdc: config.priceUsdc,
      facilitatorUrl: config.facilitatorUrl,
    });
  }
  return accepts;
}

export function discoveryDocument(config: PaymentConfig) {
  return {
    x402Version: 2,
    facilitatorUrl: config.facilitatorUrl,
    paymentHeaders: [...PAYMENT_HEADERS],
    accepts: discoveryAccepts(config),
    endpoints: endpointPolicies.map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      access: endpoint.access,
      summary: endpoint.summary,
      ...(endpoint.access === "paid"
        ? { priceUsdc: config.priceUsdc, maxAmountRequired: config.maxAmountRequired }
        : {}),
    })),
    flow:
      "POST /attest with no PAYMENT-SIGNATURE returns 402 and a PAYMENT-REQUIRED header. " +
      "An Algorand source accepts Algorand USDC. A Base source accepts Base USDC or Algorand USDC when configured. " +
      "A Solana source accepts Solana USDC or Algorand USDC when configured. " +
      "Sign one advertised option and retry with PAYMENT-SIGNATURE. " +
      "A successful response may include PAYMENT-RESPONSE. POST /verify is free.",
  };
}

function freeGet(id: string) {
  const endpoint = endpointPolicies.find((entry) => entry.id === id);
  return {
    get: {
      operationId: endpoint?.id ?? id,
      summary: endpoint?.summary ?? id,
      description: endpoint?.description ?? "",
      responses: { "200": { description: endpoint?.summary ?? id } },
    },
  };
}

export function openApiDocument(config: PaymentConfig) {
  const paid = endpointPolicies.find((endpoint) => endpoint.id === "attest");
  const verify = endpointPolicies.find((endpoint) => endpoint.id === "verify");
  return {
    openapi: "3.1.0",
    info: {
      title: "pq-attest",
      version: "0.1.0",
      description:
        "Attest a confirmed transaction from a supported chain and verify the ML-DSA-65 proof bundle. " +
        "The attestation transaction is on Algorand MainNet. " +
        "POST /attest is paid with Algorand USDC, with Base USDC when the source is a Base transaction, " +
        "or with Solana USDC when the source is a Solana transaction. POST /verify is free.",
    },
    servers: [{ url: "/" }],
    paths: {
      "/.well-known/x402": freeGet("wellKnownX402"),
      "/.well-known/x402.json": freeGet("wellKnownX402Json"),
      "/.well-known/agent-card.json": freeGet("agentCard"),
      "/.well-known/agent.json": freeGet("agentJson"),
      "/.well-known/ai-plugin.json": freeGet("aiPlugin"),
      "/llms.txt": freeGet("llmsTxt"),
      "/health": {
        get: {
          operationId: "health",
          summary: endpointPolicies[0]?.summary,
          responses: { "200": { description: "Process is up" } },
        },
      },
      "/ready": {
        get: {
          operationId: "ready",
          summary: endpointPolicies[1]?.summary,
          responses: {
            "200": { description: "Connected to Algorand MainNet" },
            "503": { description: "MainNet is not reachable" },
          },
        },
      },
      "/discovery": {
        get: {
          operationId: "discovery",
          summary: endpointPolicies[2]?.summary,
          responses: { "200": { description: "Endpoint catalog and x402 terms" } },
        },
      },
      "/openapi.json": {
        get: {
          operationId: "openapi",
          summary: endpointPolicies[3]?.summary,
          responses: { "200": { description: "This document" } },
        },
      },
      "/verify": {
        post: {
          operationId: "verify",
          summary: verify?.summary,
          description: verify?.description,
          parameters: [
            {
              name: "chain",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["1", "true"] },
              description: "Re-fetch the source and attest transactions from MainNet indexer.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProofBundle" },
              },
            },
          },
          responses: {
            "200": { description: "Bundle verified" },
            "400": { description: "Bundle rejected" },
            "404": { description: "Indexer has no matching transaction" },
          },
        },
      },
      "/attest": {
        post: {
          operationId: "attest",
          summary: paid?.summary,
          description: paid?.description,
          "x-x402": {
            version: 2,
            scheme: config.scheme,
            network: config.payTo ? config.network : config.payToBase ? BASE_NETWORK : SOLANA_NETWORK,
            asset: config.payTo ? config.asset : config.payToBase ? config.baseAsset : config.solanaAsset,
            payTo: config.payTo || config.payToBase || config.payToSolana,
            priceUsdc: config.priceUsdc,
            maxAmountRequired: config.maxAmountRequired,
            facilitatorUrl: config.facilitatorUrl,
            headers: [...PAYMENT_HEADERS],
            accepts: discoveryAccepts(config),
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["txid", "chain"],
                  properties: {
                    txid: {
                      type: "string",
                      description: "Confirmed transaction id. It must match chain.",
                    },
                    chain: {
                      type: "string",
                      enum: [...SOURCE_CHAINS],
                      description: "Source chain. Required. The transaction id must match this chain.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "ML-DSA-65 proof bundle. May include a PAYMENT-RESPONSE header after settlement.",
              headers: {
                "PAYMENT-RESPONSE": {
                  schema: { type: "string" },
                  description: "Settlement receipt from the facilitator, when present.",
                },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProofBundle" },
                },
              },
            },
            "400": { description: "txid is missing or not a transaction id" },
            "402": {
              description:
                "Payment required. Read PAYMENT-REQUIRED, pay one advertised USDC option, and retry with PAYMENT-SIGNATURE.",
              headers: {
                "PAYMENT-REQUIRED": {
                  required: true,
                  schema: { type: "string" },
                  description: "x402 payment requirements for this request.",
                },
              },
            },
            "404": { description: "Indexer has no transaction with this id" },
          },
        },
      },
    },
    components: {
      schemas: {
        ProofBundle: {
          type: "object",
          required: ["version", "network", "source", "attest", "attestor", "signature"],
          properties: {
            version: { type: "integer", const: 1 },
            network: { type: "string", const: "algorand-mainnet" },
            source: {
              type: "object",
              required: ["txnId", "hashSha256", "txnBytesBase64"],
              properties: {
                chain: { type: "string", enum: [...SOURCE_CHAINS] },
                txnId: { type: "string" },
                hashSha256: { type: "string" },
                txnBytesBase64: { type: "string" },
              },
            },
            attest: {
              type: "object",
              required: ["txnId", "round", "note"],
              properties: {
                txnId: { type: "string" },
                round: { type: "integer" },
                note: { type: "string" },
              },
            },
            attestor: {
              type: "object",
              required: ["algorandAddress", "pqPublicKey"],
              properties: {
                algorandAddress: { type: "string" },
                pqPublicKey: { type: "string" },
              },
            },
            signature: {
              type: "object",
              required: ["alg", "sigBase64"],
              properties: {
                alg: { type: "string", const: "ML-DSA-65" },
                sigBase64: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}
