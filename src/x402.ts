import { Buffer } from "node:buffer";
import type { PaymentConfig } from "./policy.ts";
import { SOURCE_CHAINS } from "./source.ts";

export const ATTEST_DESCRIPTION = "pq-attest proof bundle for a confirmed transaction, recorded on Algorand MainNet";
export const BASE_ATTEST_DESCRIPTION =
  "pq-attest proof bundle for a confirmed Base transaction, recorded on Algorand MainNet";
/** CAIP-2 id advertised by the GoPlausible facilitator for Algorand MainNet. */
export const FACILITATOR_ALGORAND_MAINNET = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
export const BASE_MAINNET = "eip155:8453";
export const BASE_USDC_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_USDC_NAME = "USD Coin";
export const BASE_USDC_VERSION = "2";
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_USDC_ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_ATTEST_DESCRIPTION =
  "pq-attest proof bundle for a confirmed Solana transaction, recorded on Algorand MainNet";
export const MAX_TIMEOUT_SECONDS = 60;

export interface PaymentAccept {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { feePayer?: string; name?: string; version?: string };
}

export const EXAMPLE_ATTEST_TXID = "OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA";
export const MERCHANT_NAME = "PQ Attest";
export const MERCHANT_WEBSITE = "https://pqattest.com";
export const MERCHANT_LOGO = "https://pqattest.com/favicon.png";
export const MERCHANT_TAGS = ["attestation", "algorand", "x402"] as const;

const BAZAAR_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    input: {
      type: "object",
      properties: {
        type: { type: "string", const: "http" },
        method: { type: "string", enum: ["POST", "PUT", "PATCH"] },
        bodyType: { type: "string", enum: ["json", "form-data", "text"] },
        body: {
          type: "object",
          required: ["txid", "chain"],
          additionalProperties: false,
          properties: {
            txid: { type: "string" },
            chain: { type: "string", enum: [...SOURCE_CHAINS] },
          },
        },
      },
      required: ["type", "method", "bodyType", "body"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        type: { type: "string" },
        example: { type: "object" },
      },
      required: ["type"],
    },
  },
  required: ["input"],
} as const;

const MERCHANT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    website: { type: "string" },
    logo: { type: "string" },
    categories: { type: "array", items: { type: "string" } },
  },
} as const;

export function paymentExtensions(): Record<string, unknown> {
  return {
    bazaar: {
      info: {
        input: {
          type: "http",
          method: "POST",
          bodyType: "json",
          body: { txid: EXAMPLE_ATTEST_TXID, chain: "algorand" },
        },
        output: {
          type: "json",
          example: {
            version: 1,
            network: "algorand-mainnet",
            source: { txnId: EXAMPLE_ATTEST_TXID, hashSha256: "ab".repeat(32) },
            attest: { txnId: "ATTEST", round: 1, note: "attest:v1" },
            signature: { alg: "ML-DSA-65" },
          },
        },
      },
      schema: BAZAAR_SCHEMA,
    },
    "x402-merchant": {
      info: {
        name: MERCHANT_NAME,
        website: MERCHANT_WEBSITE,
        logo: MERCHANT_LOGO,
        categories: [...MERCHANT_TAGS],
      },
      schema: MERCHANT_SCHEMA,
    },
  };
}

export interface PaymentRequired {
  x402Version: 2;
  error: "Payment Required";
  resource: {
    url: string;
    description: string;
    mimeType: "application/json";
    serviceName: string;
    tags: string[];
    iconUrl: string;
  };
  accepts: PaymentAccept[];
  extensions: Record<string, unknown>;
}

export interface SignedPayment {
  x402Version: number;
  paymentPayload: Record<string, unknown>;
  paymentRequirements: PaymentAccept;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function paymentRequiredDocument(
  config: PaymentConfig,
  resourceUrl: string,
  accepts: PaymentAccept[],
  description = ATTEST_DESCRIPTION,
): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment Required",
    resource: {
      url: resourceUrl,
      description,
      mimeType: "application/json",
      serviceName: MERCHANT_NAME,
      tags: [...MERCHANT_TAGS],
      iconUrl: MERCHANT_LOGO,
    },
    accepts,
    extensions: paymentExtensions(),
  };
}

export function algorandAccept(config: PaymentConfig, feePayer: string): PaymentAccept {
  return {
    scheme: config.scheme,
    network: FACILITATOR_ALGORAND_MAINNET,
    asset: config.asset,
    amount: config.maxAmountRequired,
    payTo: config.payTo,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { feePayer },
  };
}

export function baseAccept(config: PaymentConfig, extra: { name: string; version: string }): PaymentAccept {
  return {
    scheme: config.scheme,
    network: BASE_MAINNET,
    asset: BASE_USDC_ASSET,
    amount: config.maxAmountRequired,
    payTo: config.payToBase,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra,
  };
}

export function solanaAccept(config: PaymentConfig, feePayer: string): PaymentAccept {
  return {
    scheme: config.scheme,
    network: SOLANA_MAINNET,
    asset: SOLANA_USDC_ASSET,
    amount: config.maxAmountRequired,
    payTo: config.payToSolana,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { feePayer },
  };
}

export function facilitatorUrlFor(accept: PaymentAccept, config: { facilitatorUrl: string }): string {
  if (
    accept.network === FACILITATOR_ALGORAND_MAINNET ||
    accept.network === BASE_MAINNET ||
    accept.network === SOLANA_MAINNET
  ) {
    return config.facilitatorUrl;
  }
  throw new Error(`Unsupported payment network ${accept.network}.`);
}

export function encodeHeaderJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export async function loadFeePayer(facilitatorUrl: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchImpl(facilitatorPath(facilitatorUrl, "/supported"));
  if (!response.ok) {
    throw new Error(`Facilitator supported failed (${response.status}).`);
  }
  const body = (await response.json()) as {
    kinds?: { scheme?: string; network?: string; extra?: { feePayer?: string } }[];
  };
  const kind = body.kinds?.find(
    (entry) => entry.scheme === "exact" && entry.network === FACILITATOR_ALGORAND_MAINNET,
  );
  const feePayer = kind?.extra?.feePayer?.trim() ?? "";
  if (!feePayer) {
    throw new Error("Facilitator did not advertise an Algorand MainNet fee payer.");
  }
  return feePayer;
}

export async function loadSolanaFeePayer(facilitatorUrl: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchImpl(facilitatorPath(facilitatorUrl, "/supported"));
  if (!response.ok) {
    throw new Error(`Facilitator supported failed (${response.status}).`);
  }
  const body = (await response.json()) as {
    kinds?: { scheme?: string; network?: string; extra?: { feePayer?: string } }[];
  };
  const kind = body.kinds?.find((entry) => entry.scheme === "exact" && entry.network === SOLANA_MAINNET);
  const feePayer = kind?.extra?.feePayer?.trim() ?? "";
  if (!feePayer) {
    throw new Error("Facilitator did not advertise a Solana fee payer.");
  }
  return feePayer;
}

export async function loadBaseExtra(
  facilitatorUrl: string,
  fetchImpl: FetchLike,
): Promise<{ name: string; version: string }> {
  try {
    const response = await fetchImpl(facilitatorPath(facilitatorUrl, "/supported"));
    if (!response.ok) {
      return { name: BASE_USDC_NAME, version: BASE_USDC_VERSION };
    }
    const body = (await response.json()) as {
      kinds?: { scheme?: string; network?: string; extra?: { name?: string; version?: string } }[];
    };
    const kind = body.kinds?.find((entry) => entry.scheme === "exact" && entry.network === BASE_MAINNET);
    const name = kind?.extra?.name?.trim() || BASE_USDC_NAME;
    const version = kind?.extra?.version?.trim() || BASE_USDC_VERSION;
    return { name, version };
  } catch {
    return { name: BASE_USDC_NAME, version: BASE_USDC_VERSION };
  }
}

export function readSignedPayment(header: string, expected: PaymentAccept[]): SignedPayment {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new Error("PAYMENT-SIGNATURE is not valid base64 JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("PAYMENT-SIGNATURE payload must be a JSON object.");
  }
  const paymentPayload = payload as Record<string, unknown>;
  const accepted = paymentPayload.accepted;
  if (!accepted || typeof accepted !== "object" || Array.isArray(accepted)) {
    throw new Error("PAYMENT-SIGNATURE is missing accepted payment terms.");
  }
  const terms = accepted as Record<string, unknown>;
  const match = expected.find((accept) => termsMatch(terms, accept));
  if (!match) {
    throw new Error("PAYMENT-SIGNATURE does not match the advertised payment terms.");
  }
  const version = paymentPayload.x402Version;
  return {
    x402Version: typeof version === "number" ? version : 2,
    paymentPayload,
    paymentRequirements: match,
  };
}

export async function verifyPayment(facilitatorUrl: string, payment: SignedPayment, fetchImpl: FetchLike): Promise<boolean> {
  const body = await postFacilitator(facilitatorUrl, "/verify", payment, fetchImpl);
  return Boolean(body && typeof body === "object" && (body as { isValid?: unknown }).isValid === true);
}

export async function settlePayment(
  facilitatorUrl: string,
  payment: SignedPayment,
  fetchImpl: FetchLike,
): Promise<string> {
  const body = await postFacilitator(facilitatorUrl, "/settle", payment, fetchImpl);
  const success = Boolean(body && typeof body === "object" && (body as { success?: unknown }).success === true);
  if (!success) {
    const reason =
      body && typeof body === "object" && typeof (body as { errorReason?: unknown }).errorReason === "string"
        ? (body as { errorReason: string }).errorReason
        : "Payment settlement failed.";
    throw new Error(reason);
  }
  return encodeHeaderJson(body);
}

function termsMatch(terms: Record<string, unknown>, expected: PaymentAccept): boolean {
  return (
    terms.scheme === expected.scheme &&
    terms.network === expected.network &&
    terms.asset === expected.asset &&
    String(terms.amount) === expected.amount &&
    terms.payTo === expected.payTo
  );
}

async function postFacilitator(
  facilitatorUrl: string,
  path: "/verify" | "/settle",
  payment: SignedPayment,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const response = await fetchImpl(facilitatorPath(facilitatorUrl, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: payment.x402Version,
      paymentPayload: payment.paymentPayload,
      paymentRequirements: payment.paymentRequirements,
    }),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Facilitator ${path} returned non-JSON (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`Facilitator ${path} failed (${response.status}).`);
  }
  return body;
}

function facilitatorPath(facilitatorUrl: string, path: string): string {
  const base = facilitatorUrl.endsWith("/") ? facilitatorUrl : `${facilitatorUrl}/`;
  return new URL(path.slice(1), base).toString();
}
