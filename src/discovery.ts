import type { PaymentConfig } from "./policy.ts";
import { FACILITATOR_ALGORAND_MAINNET, MERCHANT_LOGO, MERCHANT_NAME, MERCHANT_WEBSITE } from "./x402.ts";

export const MCP_URL = "https://mcp.pqattest.com/mcp";

const DESCRIPTION =
  "Attest a confirmed transaction from a supported chain. The attestation is recorded on Algorand MainNet and returned as an ML-DSA-65 proof bundle. POST /attest is paid with x402.";

export function wellKnownX402(origin: string, config: PaymentConfig) {
  const resource: Record<string, string> = {
    url: `${origin}/attest`,
    method: "POST",
    description: `Attest a confirmed transaction. ${config.priceUsdc} USDC.`,
    network: FACILITATOR_ALGORAND_MAINNET,
    asset: config.asset,
    amount: config.maxAmountRequired,
  };
  if (config.payTo) {
    resource.payTo = config.payTo;
  }
  return {
    x402Version: 2,
    name: MERCHANT_NAME,
    description: DESCRIPTION,
    resources: [resource],
  };
}

export function x402Manifest(origin: string, config: PaymentConfig) {
  return {
    service: "pq-attest",
    name: MERCHANT_NAME,
    version: "0.1.0",
    description: DESCRIPTION,
    x402Version: 2,
    website: MERCHANT_WEBSITE,
    logoUrl: MERCHANT_LOGO,
    docsUrl: MERCHANT_WEBSITE,
    llmsTxtUrl: `${origin}/llms.txt`,
    openapiUrl: `${origin}/openapi.json`,
    discoveryUrl: `${origin}/discovery`,
    mcpUrl: MCP_URL,
    mcpTransport: "streamable-http",
    facilitator: config.facilitatorUrl,
    resources: [
      {
        id: "attest",
        method: "POST",
        path: "/attest",
        url: `${origin}/attest`,
        description: DESCRIPTION,
        price: {
          amount: config.maxAmountRequired,
          currency: "USDC",
          network: FACILITATOR_ALGORAND_MAINNET,
          asset: config.asset,
        },
        ...(config.payTo ? { payTo: config.payTo } : {}),
      },
    ],
  };
}

export function agentCard(origin: string) {
  return {
    protocolVersion: "0.3.0",
    name: MERCHANT_NAME,
    description: DESCRIPTION,
    url: MERCHANT_WEBSITE,
    version: "0.1.0",
    documentationUrl: `${origin}/llms.txt`,
    iconUrl: MERCHANT_LOGO,
    capabilities: { streaming: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "pq_attest",
        name: "Attest a transaction",
        description: "POST /attest. Paid per call via x402.",
        tags: ["x402", "algorand", "attestation"],
        examples: [`POST ${origin}/attest`],
      },
    ],
  };
}

export function aiPlugin(origin: string) {
  return {
    schema_version: "v1",
    name_for_human: MERCHANT_NAME,
    name_for_model: "pq-attest",
    description_for_human: DESCRIPTION,
    description_for_model:
      "Call POST /attest to fingerprint a confirmed transaction. The first call returns HTTP 402. Pay the advertised USDC requirement and retry with PAYMENT-SIGNATURE. POST /verify is free.",
    api: { type: "openapi", url: `${origin}/openapi.json` },
    logo_url: MERCHANT_LOGO,
  };
}

export function llmsText(origin: string, config: PaymentConfig): string {
  const payTo = config.payTo ? ` Pay to ${config.payTo}.` : "";
  return [
    "# PQ Attest",
    "",
    `> ${DESCRIPTION}`,
    "",
    "## Paid endpoints",
    `- [Attest](${origin}/attest): POST { "txid": "<id>", "chain": "<network>" }. ${config.priceUsdc} USDC.${payTo}`,
    "",
    "## Free endpoints",
    `- POST ${origin}/verify`,
    `- GET ${origin}/discovery`,
    `- GET ${origin}/openapi.json`,
    "",
    "## Paying",
    `- Protocol: x402 (v2), settled by ${config.facilitatorUrl}`,
    `- Network: Algorand MainNet. Asset: USDC (${config.asset}). Amount: ${config.maxAmountRequired} micro-USDC.`,
    ...(config.payToBase ? [`- Base USDC (${config.baseAsset}) to ${config.payToBase}.`] : []),
    ...(config.payToSolana ? [`- Solana USDC (${config.solanaAsset}) to ${config.payToSolana}.`] : []),
    "- On HTTP 402, read PAYMENT-REQUIRED, sign one advertised option, and retry with PAYMENT-SIGNATURE.",
    "",
    "## Docs",
    `- [x402 manifest](${origin}/.well-known/x402.json)`,
    `- [OpenAPI](${origin}/openapi.json)`,
    `- [MCP](${MCP_URL})`,
    "",
  ].join("\n");
}
