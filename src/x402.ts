import { Buffer } from "node:buffer";
import type { PaymentConfig } from "./policy.ts";

export const ATTEST_DESCRIPTION = "pq-attest proof bundle for a confirmed Algorand MainNet transaction";
/** CAIP-2 id advertised by the GoPlausible facilitator for Algorand MainNet. */
export const FACILITATOR_ALGORAND_MAINNET = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
export const MAX_TIMEOUT_SECONDS = 60;

export interface PaymentAccept {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { feePayer: string };
}

export interface PaymentRequired {
  x402Version: 2;
  error: "Payment Required";
  resource: {
    url: string;
    description: string;
    mimeType: "application/json";
  };
  accepts: [PaymentAccept];
}

export interface SignedPayment {
  x402Version: number;
  paymentPayload: Record<string, unknown>;
  paymentRequirements: PaymentAccept;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function paymentRequiredDocument(config: PaymentConfig, resourceUrl: string, feePayer: string): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment Required",
    resource: {
      url: resourceUrl,
      description: ATTEST_DESCRIPTION,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: config.scheme,
        network: FACILITATOR_ALGORAND_MAINNET,
        asset: config.asset,
        amount: config.maxAmountRequired,
        payTo: config.payTo,
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        extra: { feePayer },
      },
    ],
  };
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

export function readSignedPayment(header: string, expected: PaymentAccept): SignedPayment {
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
  if (!termsMatch(terms, expected)) {
    throw new Error("PAYMENT-SIGNATURE does not match the advertised payment terms.");
  }
  const version = paymentPayload.x402Version;
  return {
    x402Version: typeof version === "number" ? version : 2,
    paymentPayload,
    paymentRequirements: expected,
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
