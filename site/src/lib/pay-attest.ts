import { Buffer } from "buffer";
import algosdk from "algosdk";
import { x402Client } from "@x402/core/client";
import type { PaymentRequired as X402Required } from "@x402/core/types";
import type { ClientEvmSigner } from "@x402/evm";
import type { ClientSvmSigner } from "@x402/svm";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { base } from "viem/chains";
import { readSolanaUsdc, SOLANA_RPC_URL } from "./solana-balance";

const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!scope.Buffer) {
  scope.Buffer = Buffer;
}

export const USDC_ASSET_ID = 31566704n;
export const BASE_USDC_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_NETWORK = "eip155:8453";
export const SOLANA_USDC_ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export type PayNetwork = "base" | "algorand" | "solana";

const baseClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

export class OptInRequired extends Error {
  constructor() {
    super("This wallet is not opted in to USDC.");
    this.name = "OptInRequired";
  }
}

export class InsufficientUsdc extends Error {
  readonly need: string;
  readonly have: string;

  constructor(need: string, have: string) {
    super(`This wallet holds ${have} USDC. An attestation costs ${need} USDC.`);
    this.name = "InsufficientUsdc";
    this.need = need;
    this.have = have;
  }
}

export interface UsdcHolding {
  optedIn: boolean;
  amount: bigint;
}

export interface ListedPrice {
  priceUsdc: string;
  atomic: string;
}

export interface ProofView {
  sourceId: string;
  hashSha256: string;
  attestId: string;
  round: number | null;
  algorithm: string;
  json: string;
}

export type PayPhase = "terms" | "signing" | "recording";

interface PaymentAccept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown> | null;
}

interface PaymentRequiredDoc {
  resource: Record<string, unknown>;
  accepts: PaymentAccept[];
  extensions: Record<string, unknown>;
}

type SignTransactions = (
  txns: Uint8Array[],
  indexesToSign?: number[],
) => Promise<(Uint8Array | null)[]>;

export function formatAtomicUsdc(amount: string | bigint): string {
  const value = typeof amount === "bigint" ? amount : BigInt(amount);
  const scale = 1_000_000n;
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Solana rejects a USDC transfer whose sender and recipient are the same account. */
export function solanaSelfPaymentMessage(payer: string, payTo: string): string | null {
  if (payer !== payTo) {
    return null;
  }
  return "This wallet receives the Solana USDC. Pay from another Solana wallet.";
}

export function walletErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|cancel|denied|declined|closed/i.test(message)) {
    return "The wallet did not sign.";
  }
  return message || "The wallet did not sign.";
}

export async function fetchListedPrice(discoveryUrl: string, network?: PayNetwork): Promise<ListedPrice | null> {
  const response = await fetch(discoveryUrl);
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as {
    accepts?: { network?: string; priceUsdc?: string; maxAmountRequired?: string }[];
  };
  const priced = (body.accepts ?? []).filter((item) => item.priceUsdc && item.maxAmountRequired);
  const accept = network
    ? priced.find((item) => item.network !== undefined && acceptMatches(item.network, network))
    : priced[0];
  if (!accept?.priceUsdc || !accept.maxAmountRequired) {
    return null;
  }
  return { priceUsdc: accept.priceUsdc, atomic: accept.maxAmountRequired };
}

export function selectAccept(accepts: readonly PaymentAccept[], network: PayNetwork): PaymentAccept {
  const accept = accepts.find((item) => acceptMatches(item.network, network));
  if (!accept) {
    throw new Error(missingRailMessage(network));
  }
  return accept;
}

function acceptMatches(networkId: string, network: PayNetwork): boolean {
  if (network === "base") {
    return networkId === BASE_NETWORK;
  }
  if (network === "solana") {
    return networkId === SOLANA_NETWORK;
  }
  return networkId.startsWith("algorand");
}

function missingRailMessage(network: PayNetwork): string {
  if (network === "base") {
    return "This request has no Base USDC payment option.";
  }
  if (network === "solana") {
    return "This request has no Solana USDC payment option.";
  }
  return "This request has no Algorand USDC payment option.";
}

export async function readUsdcHolding(algod: algosdk.Algodv2, address: string): Promise<UsdcHolding> {
  try {
    const info = await algod.accountInformation(address).do();
    const holding = info.assets?.find((asset) => asset.assetId === USDC_ASSET_ID);
    if (!holding) {
      return { optedIn: false, amount: 0n };
    }
    return { optedIn: true, amount: holding.amount };
  } catch (error) {
    if (statusOf(error) === 404) {
      return { optedIn: false, amount: 0n };
    }
    throw new Error("Could not read the USDC balance for this wallet.");
  }
}

export async function readBaseUsdc(address: Address): Promise<UsdcHolding> {
  try {
    const amount = await baseClient.readContract({
      address: BASE_USDC_ASSET,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    return { optedIn: true, amount };
  } catch {
    throw new Error("Could not read the USDC balance for this wallet.");
  }
}

export { readSolanaUsdc };

export async function optInToUsdc(input: {
  algod: algosdk.Algodv2;
  address: string;
  signTransactions: (txns: algosdk.Transaction[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>;
  onConfirming?: () => void;
}): Promise<void> {
  const params = await input.algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: input.address,
    receiver: input.address,
    assetIndex: USDC_ASSET_ID,
    amount: 0,
    suggestedParams: params,
  });
  let signed: (Uint8Array | null)[];
  try {
    signed = await input.signTransactions([txn], [0]);
  } catch (error) {
    throw new Error(walletErrorMessage(error));
  }
  const blob = signed[0];
  if (!blob) {
    throw new Error("The wallet did not sign the opt-in.");
  }
  const sent = await input.algod.sendRawTransaction(blob).do();
  input.onConfirming?.();
  await algosdk.waitForConfirmation(input.algod, sent.txid, 4);
}

interface PayCommon {
  apiBase: string;
  chain: string;
  txid: string;
  address: string;
  onPhase?: (phase: PayPhase) => void;
}

export type PayRequest = PayCommon &
  (
    | {
        network: "algorand";
        algod: algosdk.Algodv2;
        algodUrl: string;
        signTransactions: SignTransactions;
      }
    | {
        network: "base";
        signer: ClientEvmSigner;
      }
    | {
        network: "solana";
        signer: ClientSvmSigner;
      }
  );

export async function payAndAttest(input: PayRequest): Promise<ProofView> {
  const url = `${input.apiBase.replace(/\/$/, "")}/attest`;
  input.onPhase?.("terms");
  const first = await postAttest(url, input.chain, input.txid);
  if (first.response.ok) {
    return proofFromBody(JSON.parse(first.text || "null"));
  }
  if (first.response.status !== 402) {
    throw new Error(await errorMessage(first.response, first.text));
  }

  const required = parseRequired(first.response.headers.get("payment-required"));
  const accept = selectAccept(required.accepts, input.network);
  const holding = await readHolding(input);
  const need = formatAtomicUsdc(accept.amount);
  if (input.network === "algorand" && !holding.optedIn) {
    throw new OptInRequired();
  }
  if (input.network === "solana" && !holding.optedIn) {
    throw new Error("This wallet has no USDC account.");
  }
  const selfPayment = input.network === "solana" ? solanaSelfPaymentMessage(input.address, accept.payTo) : null;
  if (selfPayment) {
    throw new Error(selfPayment);
  }
  if (holding.amount < BigInt(accept.amount)) {
    throw new InsufficientUsdc(need, formatAtomicUsdc(holding.amount));
  }

  input.onPhase?.("signing");
  let signature: string;
  try {
    signature = await createSignature(input, required);
  } catch (error) {
    throw new Error(walletErrorMessage(error));
  }

  input.onPhase?.("recording");
  const second = await postAttest(url, input.chain, input.txid, signature);
  if (!second.response.ok) {
    throw new Error(explainPaymentFailure(await errorMessage(second.response, second.text), input.network, accept.payTo, input.address));
  }
  return proofFromBody(JSON.parse(second.text || "null"));
}

async function readHolding(input: PayRequest): Promise<UsdcHolding> {
  if (input.network === "algorand") {
    return readUsdcHolding(input.algod, input.address);
  }
  if (input.network === "base") {
    return readBaseUsdc(asBaseAddress(input.address));
  }
  return readSolanaUsdc(input.address);
}

function paymentClient(input: PayRequest): x402Client {
  const client = new x402Client((_version, requirements) => {
    const selected = requirements.find((item) => acceptMatches(item.network, input.network));
    if (!selected) {
      throw new Error(missingRailMessage(input.network));
    }
    return selected;
  }).setSpendControls(false);
  if (input.network === "algorand") {
    return client.register(
      "algorand:*",
      new ExactAvmScheme(
        {
          address: input.address,
          signTransactions: async (txns, indexesToSign) => {
            try {
              return await input.signTransactions(txns, indexesToSign);
            } catch (error) {
              throw new Error(walletErrorMessage(error));
            }
          },
        },
        { algodUrl: input.algodUrl, algodToken: "" },
      ),
    );
  }
  if (input.network === "base") {
    return client.register(
      "eip155:*",
      new ExactEvmScheme(
        {
          ...input.signer,
          readContract:
            input.signer.readContract ??
            ((args) => baseClient.readContract(args as Parameters<typeof baseClient.readContract>[0])),
        },
        { rpcUrl: "https://mainnet.base.org" },
      ),
    );
  }
  return client.register("solana:*", new ExactSvmScheme(input.signer, { rpcUrl: SOLANA_RPC_URL }));
}

function x402Required(required: PaymentRequiredDoc): X402Required {
  const url = required.resource.url;
  if (typeof url !== "string" || !url.includes("://")) {
    throw new Error("Payment terms were not readable.");
  }
  const tags = Array.isArray(required.resource.tags)
    ? required.resource.tags.filter((tag): tag is string => typeof tag === "string")
    : undefined;
  return {
    x402Version: 2,
    resource: {
      url,
      description: typeof required.resource.description === "string" ? required.resource.description : undefined,
      mimeType: typeof required.resource.mimeType === "string" ? required.resource.mimeType : undefined,
      serviceName: typeof required.resource.serviceName === "string" ? required.resource.serviceName : undefined,
      tags,
      iconUrl: typeof required.resource.iconUrl === "string" ? required.resource.iconUrl : undefined,
    },
    accepts: required.accepts.map((accept) => ({
      scheme: accept.scheme,
      network: accept.network as X402Required["accepts"][number]["network"],
      asset: accept.asset,
      amount: accept.amount,
      payTo: accept.payTo,
      maxTimeoutSeconds: accept.maxTimeoutSeconds,
      extra: { ...(accept.extra ?? {}) },
    })),
    extensions: required.extensions,
  };
}

async function createSignature(input: PayRequest, required: PaymentRequiredDoc): Promise<string> {
  const payload = await paymentClient(input).createPaymentPayload(x402Required(required));
  return encodeHeaderJson(payload);
}

function explainPaymentFailure(message: string, network: PayNetwork, payTo: string, payer: string): string {
  if (network === "solana") {
    const selfPayment = solanaSelfPaymentMessage(payer, payTo);
    if (
      selfPayment &&
      (message === "transaction_simulation_failed" || message === "invalid_exact_svm_transaction_simulation_failed")
    ) {
      return selfPayment;
    }
  }
  if (message === "transaction_simulation_failed" || message === "invalid_exact_svm_transaction_simulation_failed") {
    return "The Solana payment was rejected.";
  }
  return message;
}

function asBaseAddress(address: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("Connect a Base wallet.");
  }
  return address as Address;
}

async function postAttest(url: string, chain: string, txid: string, signature?: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(signature ? { "PAYMENT-SIGNATURE": signature } : {}),
      },
      body: JSON.stringify({ txid, chain }),
    });
  } catch {
    throw new Error("Could not reach the attestation service.");
  }
  const text = await response.text();
  return { response, text };
}

async function errorMessage(response: Response, text: string): Promise<string> {
  try {
    const body = text ? (JSON.parse(text) as { error?: unknown }) : {};
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    /* The body was not JSON. */
  }
  return `The attestation request failed (${response.status}).`;
}

function parseRequired(header: string | null): PaymentRequiredDoc {
  if (!header) {
    throw new Error("Payment terms were not included in the response.");
  }
  const decoded = decodeHeaderJson(header);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Payment terms were not readable.");
  }
  const record = decoded as Record<string, unknown>;
  const resource = record.resource;
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new Error("Payment terms were not readable.");
  }
  const accepts = Array.isArray(record.accepts) ? record.accepts.filter(isAccept) : [];
  const extensions =
    record.extensions && typeof record.extensions === "object" && !Array.isArray(record.extensions)
      ? (record.extensions as Record<string, unknown>)
      : {};
  return { resource: resource as Record<string, unknown>, accepts, extensions };
}

function isAccept(value: unknown): value is PaymentAccept {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.scheme === "string" &&
    typeof record.network === "string" &&
    typeof record.amount === "string" &&
    typeof record.asset === "string" &&
    typeof record.payTo === "string" &&
    typeof record.maxTimeoutSeconds === "number"
  );
}

function proofFromBody(body: unknown): ProofView {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The attestation response was not a proof bundle.");
  }
  const record = body as Record<string, unknown>;
  const source = recordOf(record.source);
  const attest = recordOf(record.attest);
  const signature = recordOf(record.signature);
  const sourceId = typeof source?.txnId === "string" ? source.txnId : "";
  const hashSha256 = typeof source?.hashSha256 === "string" ? source.hashSha256 : "";
  const attestId = typeof attest?.txnId === "string" ? attest.txnId : "";
  if (!sourceId || !hashSha256 || !attestId) {
    throw new Error("The attestation response was missing the proof.");
  }
  const round = typeof attest?.round === "number" ? attest.round : null;
  const algorithm = typeof signature?.alg === "string" ? signature.alg : "ML-DSA-65";
  return {
    sourceId,
    hashSha256,
    attestId,
    round,
    algorithm,
    json: JSON.stringify(body, null, 2),
  };
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function decodeHeaderJson(header: string): unknown {
  try {
    const binary = atob(header.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Payment terms were not readable.");
  }
}

function encodeHeaderJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
