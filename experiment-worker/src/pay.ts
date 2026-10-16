import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import algosdk from "algosdk";

import { MAX_ATOMIC_USDC } from "./constants.js";
import type { PaidAttestation } from "./run.js";

export interface ListedAccept {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PayInput {
  apiUrl: string;
  algodUrl: string;
  mnemonic: string;
  height: number;
  fetchImpl: typeof fetch;
  createSignature?: (required: PaymentRequired) => Promise<string>;
}

export function selectAlgorandAccept(accepts: readonly ListedAccept[]): ListedAccept {
  const accept = accepts.find((item) => item.network.startsWith("algorand"));
  if (!accept) {
    throw new Error("This request has no Algorand USDC payment option.");
  }
  return accept;
}

export function assertPriceCap(amount: string): void {
  if (!/^[0-9]+$/.test(amount)) {
    throw new Error("Algorand USDC price was not an atomic amount.");
  }
  if (BigInt(amount) > MAX_ATOMIC_USDC) {
    throw new Error(`Algorand USDC price ${amount} exceeds the 1000 atomic cap.`);
  }
}

export function readPaidBundle(body: unknown, height: number, paidAtomic: string): PaidAttestation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The attestation response was missing the proof.");
  }
  const record = body as Record<string, unknown>;
  const anchor = record.anchor;
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    throw new Error("The attestation response was missing the proof.");
  }
  const txnId = (anchor as { txnId?: unknown }).txnId;
  if (record.schema !== "block-attest-v1" || record.chain !== "bitcoin") {
    throw new Error("The attestation response was not a Bitcoin block bundle.");
  }
  if (record.height !== String(height)) {
    throw new Error(`The attestation response was for block ${String(record.height)}, not ${height}.`);
  }
  if (typeof record.blockHash !== "string" || typeof txnId !== "string") {
    throw new Error("The attestation response was missing the proof.");
  }
  return {
    blockHash: record.blockHash,
    attestTxnId: txnId,
    paidAtomic,
    bundle: body,
  };
}

export async function payForBitcoinBlock(input: PayInput): Promise<PaidAttestation> {
  const mnemonic = input.mnemonic.trim();
  if (!mnemonic) {
    throw new Error("PAYER_MNEMONIC is required.");
  }
  const url = `${input.apiUrl.replace(/\/$/, "")}/attest-block`;
  const payload = { chain: "bitcoin", height: String(input.height) };
  const first = await post(input.fetchImpl, url, payload);
  if (first.response.status !== 402) {
    throw new Error(errorMessage(first.response.status, first.text));
  }
  const required = paymentRequired(first.response);
  const accept = selectAlgorandAccept(required.accepts);
  assertPriceCap(accept.amount);
  const signature = input.createSignature
    ? await input.createSignature(required)
    : await signAlgorandPayment(mnemonic, input.algodUrl, required);
  const second = await post(input.fetchImpl, url, payload, signature);
  if (!second.response.ok) {
    throw new Error(errorMessage(second.response.status, second.text));
  }
  let body: unknown;
  try {
    body = JSON.parse(second.text);
  } catch {
    throw new Error("The attestation response was missing the proof.");
  }
  return readPaidBundle(body, input.height, accept.amount);
}

function paymentRequired(response: Response): PaymentRequired {
  const http = new x402HTTPClient(new x402Client());
  return http.getPaymentRequiredResponse((name) => response.headers.get(name));
}

async function signAlgorandPayment(mnemonic: string, algodUrl: string, required: PaymentRequired): Promise<string> {
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const client = new x402Client((_version, requirements) => selectRequirement(requirements))
    .setSpendControls(false)
    .register(
      "algorand:*",
      new ExactAvmScheme(
        {
          address: account.addr.toString(),
          signTransactions: (txns, indexesToSign) => signGroup(account.sk, txns, indexesToSign),
        },
        { algodUrl, algodToken: "" },
      ),
    );
  const http = new x402HTTPClient(client);
  const payload = await http.createPaymentPayload(required);
  const signature = http.encodePaymentSignatureHeader(payload)["PAYMENT-SIGNATURE"];
  if (!signature) {
    throw new Error("The Algorand payment could not be signed.");
  }
  return signature;
}

function selectRequirement(requirements: PaymentRequirements[]): PaymentRequirements {
  const selected = requirements.find((item) => item.network.startsWith("algorand"));
  if (!selected) {
    throw new Error("This request has no Algorand USDC payment option.");
  }
  assertPriceCap(selected.amount);
  return selected;
}

function signGroup(
  secretKey: Uint8Array,
  txns: Uint8Array[],
  indexesToSign?: number[],
): Promise<(Uint8Array | null)[]> {
  const indexes = new Set(indexesToSign ?? txns.map((_txn, index) => index));
  return Promise.resolve(
    txns.map((txn, index) => {
      if (!indexes.has(index)) {
        return null;
      }
      return algosdk.signTransaction(algosdk.decodeUnsignedTransaction(txn), secretKey).blob;
    }),
  );
}

async function post(
  fetchImpl: typeof fetch,
  url: string,
  payload: unknown,
  signature?: string,
): Promise<{ response: Response; text: string }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(signature ? { "PAYMENT-SIGNATURE": signature } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error.";
    throw new Error(`The attestation request failed: ${message}`);
  }
  return { response, text: await response.text() };
}

function errorMessage(status: number, text: string): string {
  try {
    const body = text ? (JSON.parse(text) as { error?: unknown }) : {};
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    /* The body was not JSON. */
  }
  return `The attestation request failed (${status}).`;
}
