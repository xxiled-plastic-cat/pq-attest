import { Buffer } from "node:buffer";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { attestTransaction, verifyBundle } from "./bundle.ts";
import { assertMainNet, createAlgorandClient } from "./client.ts";
import { discoveryDocument, loadPaymentConfig, openApiDocument } from "./policy.ts";
import type { ProofBundle, UnsignedBundle } from "./types.ts";
import {
  encodeHeaderJson,
  loadFeePayer,
  paymentRequiredDocument,
  readSignedPayment,
  settlePayment,
  verifyPayment,
  type PaymentRequired,
} from "./x402.ts";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TXID = /^[A-Z2-7]{52}$/;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, PAYMENT-SIGNATURE, PAYMENT-REQUIRED, PAYMENT-RESPONSE",
  "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
};

export interface ApiDeps {
  attest(input: {
    algorand: AlgorandClient;
    txid: string;
    mnemonic: string | undefined;
    falconSeed: string | undefined;
  }): Promise<ProofBundle>;
  verify(bundle: unknown, options: { chain?: boolean; algorand?: AlgorandClient }): Promise<UnsignedBundle>;
  createClient(): AlgorandClient;
  assertMainNet(algorand: AlgorandClient): Promise<unknown>;
  fetch?(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export function defaultDeps(): ApiDeps {
  return {
    attest: attestTransaction,
    verify: verifyBundle,
    createClient: createAlgorandClient,
    assertMainNet,
  };
}

export async function handleHttp(
  request: Request,
  deps: ApiDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const response = await route(request, deps, env);
  return withCors(response);
}

async function route(request: Request, deps: ApiDeps, env: NodeJS.ProcessEnv): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (method === "GET" && path === "/health") {
    return json(200, { ok: true });
  }

  if (method === "GET" && path === "/ready") {
    try {
      const algorand = deps.createClient();
      await deps.assertMainNet(algorand);
      return json(200, { ok: true, network: "algorand-mainnet" });
    } catch (error) {
      return json(503, { error: errorMessage(error) });
    }
  }

  if (method === "GET" && path === "/discovery") {
    return paymentDocument(env, discoveryDocument);
  }

  if (method === "GET" && path === "/openapi.json") {
    return paymentDocument(env, openApiDocument);
  }

  if (method === "POST" && path === "/verify") {
    return handleVerify(request, url, deps);
  }

  if (method === "POST" && path === "/attest") {
    return handlePaidAttest(request, deps, env);
  }

  return json(404, { error: "Not found" });
}

async function handlePaidAttest(request: Request, deps: ApiDeps, env: NodeJS.ProcessEnv): Promise<Response> {
  let config: ReturnType<typeof loadPaymentConfig>;
  try {
    config = loadPaymentConfig(env);
  } catch (error) {
    return json(500, { error: errorMessage(error) });
  }
  if (!config.payTo) {
    return json(500, { error: "X402_PAY_TO is required." });
  }

  const fetchImpl = deps.fetch ?? fetch;
  let required: PaymentRequired;
  try {
    const feePayer = await loadFeePayer(config.facilitatorUrl, fetchImpl);
    required = paymentRequiredDocument(config, request.url, feePayer);
  } catch (error) {
    return json(502, { error: errorMessage(error) });
  }

  const signature = request.headers.get("payment-signature");
  if (!signature) {
    return paymentRequiredResponse(required);
  }

  let payment: ReturnType<typeof readSignedPayment>;
  try {
    payment = readSignedPayment(signature, required.accepts[0]);
  } catch {
    return paymentRequiredResponse(required);
  }

  try {
    const valid = await verifyPayment(config.facilitatorUrl, payment, fetchImpl);
    if (!valid) {
      return paymentRequiredResponse(required);
    }
  } catch (error) {
    return json(502, { error: errorMessage(error) });
  }

  const attested = await handleAttest(request, deps, env);
  if (attested.status >= 400) {
    return attested;
  }

  try {
    const receipt = await settlePayment(config.facilitatorUrl, payment, fetchImpl);
    const headers = new Headers(attested.headers);
    headers.set("PAYMENT-RESPONSE", receipt);
    return new Response(attested.body, { status: attested.status, headers });
  } catch (error) {
    return json(502, { error: errorMessage(error) });
  }
}

function paymentRequiredResponse(required: PaymentRequired, message = "Payment Required"): Response {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("PAYMENT-REQUIRED", encodeHeaderJson(required));
  return new Response(JSON.stringify({ error: message }), { status: 402, headers });
}

async function handleAttest(request: Request, deps: ApiDeps, env: NodeJS.ProcessEnv): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return json(400, { error: "Request body must be a JSON object." });
  }
  const txid = (parsed as { txid?: unknown }).txid;
  if (typeof txid !== "string" || !TXID.test(txid)) {
    return json(400, { error: "txid must be a 52-character Algorand transaction id." });
  }

  try {
    const algorand = deps.createClient();
    await deps.assertMainNet(algorand);
    const bundle = await deps.attest({
      algorand,
      txid,
      mnemonic: env.ATTESTOR_MNEMONIC,
      falconSeed: env.ATTESTOR_FALCON_SEED,
    });
    return json(200, bundle);
  } catch (error) {
    return json(attestStatus(error), { error: errorMessage(error) });
  }
}

async function handleVerify(request: Request, url: URL, deps: ApiDeps): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  const chain = url.searchParams.get("chain") === "1" || url.searchParams.get("chain") === "true";
  try {
    const algorand = chain ? deps.createClient() : undefined;
    if (algorand) {
      await deps.assertMainNet(algorand);
    }
    const verified = await deps.verify(parsed, { chain, algorand });
    return json(200, {
      ok: true,
      chain,
      source: {
        txnId: verified.source.txnId,
        hashSha256: verified.source.hashSha256,
      },
    });
  } catch (error) {
    return json(verifyStatus(error), { error: errorMessage(error) });
  }
}

function paymentDocument(
  env: NodeJS.ProcessEnv,
  build: (config: ReturnType<typeof loadPaymentConfig>) => unknown,
): Response {
  try {
    return json(200, build(loadPaymentConfig(env)));
  } catch (error) {
    return json(500, { error: errorMessage(error) });
  }
}

async function readJson(request: Request): Promise<unknown | Response> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return json(413, { error: "Request body exceeds 2 MB." });
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return json(400, { error: "Request body must be JSON." });
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return json(413, { error: "Request body exceeds 2 MB." });
    }
    chunks.push(value);
  }

  if (total === 0) {
    return json(400, { error: "Request body must be JSON." });
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return json(400, { error: "Request body must be JSON." });
  }
}

function attestStatus(error: unknown): number {
  const message = errorMessage(error);
  if (message.includes("did not return transaction") || /\b404\b/.test(message)) {
    return 404;
  }
  if (message.startsWith("Failed to fetch transaction")) {
    return 502;
  }
  return 500;
}

function verifyStatus(error: unknown): number {
  const message = errorMessage(error);
  if (message.includes("did not return transaction") || /\b404\b/.test(message)) {
    return 404;
  }
  if (message.startsWith("Failed to fetch transaction")) {
    return 502;
  }
  return 400;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
