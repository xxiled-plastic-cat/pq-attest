import { Buffer } from "node:buffer";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { attestTransaction, noteText, verifyBundle } from "./bundle.ts";
import { assertMainNet, createAlgorandClient, fetchIndexerTransaction } from "./client.ts";
import { BLOCK_CAPABILITIES } from "./block/capabilities.ts";
import { assertInclusionSupported } from "./block/adapter.ts";
import { attestBlock, parseBlockAttestBody, parseProveBody, proveTxInclusion } from "./block/bundle.ts";
import { verifyBlockOffline, verifyInclusionOffline } from "./block/verify.ts";
import type { BlockAttestBundle, TxInclusionV1, VerifyReport } from "./block/types.ts";
import { agentCard, aiPlugin, llmsText, wellKnownX402, x402Manifest } from "./discovery.ts";
import { discoveryDocument, loadPaymentConfig, openApiDocument, type PaymentConfig } from "./policy.ts";
import { resolveSourceRequest, type SourceChain } from "./source.ts";
import type { ProofBundle, UnsignedBundle } from "./types.ts";
import {
  algorandAccept,
  baseAccept,
  encodeHeaderJson,
  enrichDiscoveryPayload,
  facilitatorUrlFor,
  loadBaseExtra,
  loadFeePayer,
  loadSolanaFeePayer,
  solanaAccept,
  paymentRequiredDocument,
  readSignedPayment,
  settlePayment,
  verifyPayment,
  type PaymentAccept,
  type PaymentRequired,
} from "./x402.ts";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

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
    chain?: SourceChain;
    mnemonic: string | undefined;
    falconSeed: string | undefined;
    fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  }): Promise<ProofBundle>;
  verify(
    bundle: unknown,
    options: {
      chain?: boolean;
      algorand?: AlgorandClient;
      fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    },
  ): Promise<UnsignedBundle>;
  createClient(): AlgorandClient;
  assertMainNet(algorand: AlgorandClient): Promise<unknown>;
  fetch?(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  attestBlock?(input: {
    chain: SourceChain;
    height: string;
    blockHash?: string;
    algorand: AlgorandClient;
    mnemonic: string | undefined;
    falconSeed: string | undefined;
    fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  }): Promise<BlockAttestBundle>;
  proveTxInclusion?(input: {
    chain: SourceChain;
    txId: string;
    height: string;
    algorand: AlgorandClient;
    mnemonic: string | undefined;
    falconSeed: string | undefined;
    fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  }): Promise<TxInclusionV1>;
  verifyBlock?(bundle: unknown, options: { anchor?: boolean; algorand?: AlgorandClient }): Promise<VerifyReport>;
  verifyInclusion?(proof: unknown): Promise<VerifyReport>;
}

export function defaultDeps(): ApiDeps {
  return {
    attest: attestTransaction,
    verify: verifyBundle,
    createClient: createAlgorandClient,
    assertMainNet,
    attestBlock,
    proveTxInclusion,
    verifyBlock: verifyBlockWithAnchor,
    verifyInclusion: async (proof) => verifyInclusionOffline(proof),
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

  if (method === "GET" && path === "/.well-known/x402") {
    return paymentDocument(env, (config) => wellKnownX402(url.origin, config));
  }

  if (method === "GET" && path === "/.well-known/x402.json") {
    return paymentDocument(env, (config) => x402Manifest(url.origin, config));
  }

  if (method === "GET" && (path === "/.well-known/agent-card.json" || path === "/.well-known/agent.json")) {
    return json(200, agentCard(url.origin));
  }

  if (method === "GET" && path === "/.well-known/ai-plugin.json") {
    return json(200, aiPlugin(url.origin));
  }

  if (method === "GET" && path === "/llms.txt") {
    const config = loadPaymentConfig(env);
    return text(llmsText(url.origin, config));
  }

  if (method === "GET" && path === "/block-capabilities") {
    return json(200, { chains: BLOCK_CAPABILITIES });
  }

  if (method === "POST" && path === "/verify-block") {
    return handleVerifyBlock(request, url, deps);
  }

  if (method === "POST" && path === "/verify-tx-inclusion") {
    return handleVerifyInclusion(request, deps);
  }

  if (method === "POST" && path === "/verify") {
    return handleVerify(request, url, deps);
  }

  if (method === "POST" && path === "/attest-block") {
    return handlePaidBlock(request, deps, env);
  }

  if (method === "POST" && path === "/prove-tx-inclusion") {
    return handlePaidProve(request, deps, env);
  }

  if (method === "POST" && path === "/attest") {
    return handlePaidAttest(request, deps, env);
  }

  return json(404, { error: "Not found" });
}

async function handlePaidAttest(request: Request, deps: ApiDeps, env: NodeJS.ProcessEnv): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return json(400, { error: "Request body must be a JSON object." });
  }
  let source: { txid: string; chain: SourceChain };
  try {
    const body = parsed as { txid?: unknown; chain?: unknown };
    source = resolveSourceRequest(body.txid, body.chain);
  } catch (error) {
    return json(400, { error: errorMessage(error) });
  }

  let config: PaymentConfig;
  try {
    config = loadPaymentConfig(env);
  } catch (error) {
    return json(500, { error: errorMessage(error) });
  }
  const fetchImpl = deps.fetch ?? fetch;
  const gate = await beginPayment(request, config, fetchImpl);
  if (gate instanceof Response) {
    return gate;
  }

  const attested = await handleAttest(source, deps, env, fetchImpl);
  if (attested.status >= 400) {
    return attested;
  }
  return settleResponse(gate, attested, fetchImpl);
}

async function handlePaidBlock(request: Request, deps: ApiDeps, env: NodeJS.ProcessEnv): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  let body: ReturnType<typeof parseBlockAttestBody>;
  try {
    body = parseBlockAttestBody(parsed);
  } catch (error) {
    return json(400, { error: errorMessage(error) });
  }
  return payFor(request, deps, env, async (fetchImpl, algorand) => {
    const run = deps.attestBlock ?? defaultDeps().attestBlock!;
    const result = await run({
      ...body,
      algorand,
      mnemonic: env.ATTESTOR_MNEMONIC,
      falconSeed: env.ATTESTOR_FALCON_SEED,
      fetchImpl,
    });
    return json(200, result);
  });
}

async function handlePaidProve(request: Request, deps: ApiDeps, env: NodeJS.ProcessEnv): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  let body: ReturnType<typeof parseProveBody>;
  try {
    body = parseProveBody(parsed);
    assertInclusionSupported(body.chain);
  } catch (error) {
    return json(400, { error: errorMessage(error) });
  }
  return payFor(request, deps, env, async (fetchImpl, algorand) => {
    const run = deps.proveTxInclusion ?? defaultDeps().proveTxInclusion!;
    const proof = await run({
      ...body,
      algorand,
      mnemonic: env.ATTESTOR_MNEMONIC,
      falconSeed: env.ATTESTOR_FALCON_SEED,
      fetchImpl,
    });
    return json(200, proof);
  });
}

async function payFor(
  request: Request,
  deps: ApiDeps,
  env: NodeJS.ProcessEnv,
  work: (
    fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
    algorand: AlgorandClient,
  ) => Promise<Response>,
): Promise<Response> {
  let config: PaymentConfig;
  try {
    config = loadPaymentConfig(env);
  } catch (error) {
    return json(500, { error: errorMessage(error) });
  }
  const fetchImpl = deps.fetch ?? fetch;
  const gate = await beginPayment(request, config, fetchImpl);
  if (gate instanceof Response) {
    return gate;
  }
  let algorand: AlgorandClient;
  try {
    algorand = deps.createClient();
    await deps.assertMainNet(algorand);
  } catch (error) {
    return json(attestStatus(error), { error: errorMessage(error) });
  }
  let result: Response;
  try {
    result = await work(fetchImpl, algorand);
  } catch (error) {
    return json(attestStatus(error), { error: errorMessage(error) });
  }
  if (result.status >= 400) {
    return result;
  }
  return settleResponse(gate, result, fetchImpl);
}

async function beginPayment(
  request: Request,
  config: PaymentConfig,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): Promise<Response | { facilitatorUrl: string; cataloged: ReturnType<typeof readSignedPayment> & { paymentPayload: ReturnType<typeof enrichDiscoveryPayload> } }> {
  if (!config.payTo && !config.payToBase && !config.payToSolana) {
    return json(500, {
      error: "X402_PAY_TO, X402_PAY_TO_BASE, or X402_PAY_TO_SOLANA is required.",
    });
  }
  let required: PaymentRequired;
  try {
    const accepts = await loadAccepts(config, fetchImpl);
    required = paymentRequiredDocument(request.url, accepts);
  } catch (error) {
    return json(502, { error: errorMessage(error) });
  }
  const signature = request.headers.get("payment-signature");
  if (!signature) {
    return paymentRequiredResponse(required);
  }
  let payment: ReturnType<typeof readSignedPayment>;
  try {
    payment = readSignedPayment(signature, required.accepts);
  } catch {
    return paymentRequiredResponse(required);
  }
  const facilitatorUrl = facilitatorUrlFor(payment.paymentRequirements, config);
  const cataloged = {
    ...payment,
    paymentPayload: enrichDiscoveryPayload(payment.paymentPayload, required),
  };
  try {
    const verdict = await verifyPayment(facilitatorUrl, cataloged, fetchImpl);
    if (!verdict.ok) {
      return paymentRequiredResponse(required, verdict.reason);
    }
  } catch (error) {
    return json(502, { error: errorMessage(error) });
  }
  return { facilitatorUrl, cataloged };
}

async function settleResponse(
  gate: { facilitatorUrl: string; cataloged: Parameters<typeof settlePayment>[1] },
  success: Response,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): Promise<Response> {
  try {
    const receipt = await settlePayment(gate.facilitatorUrl, gate.cataloged, fetchImpl);
    const headers = new Headers(success.headers);
    headers.set("PAYMENT-RESPONSE", receipt);
    return new Response(success.body, { status: success.status, headers });
  } catch (error) {
    return json(502, { error: errorMessage(error) });
  }
}

async function handleVerifyBlock(request: Request, url: URL, deps: ApiDeps): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  const anchor = url.searchParams.get("anchor") === "1" || url.searchParams.get("anchor") === "true";
  try {
    const algorand = anchor ? deps.createClient() : undefined;
    if (algorand) {
      await deps.assertMainNet(algorand);
    }
    const report = await (deps.verifyBlock ?? verifyBlockWithAnchor)(parsed, { anchor, algorand });
    return json(report.ok ? 200 : 400, report);
  } catch (error) {
    return json(400, { error: errorMessage(error) });
  }
}

async function handleVerifyInclusion(request: Request, deps: ApiDeps): Promise<Response> {
  const parsed = await readJson(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  const report = await (deps.verifyInclusion ?? (async (proof: unknown) => verifyInclusionOffline(proof)))(parsed);
  return json(report.ok ? 200 : 400, report);
}

async function verifyBlockWithAnchor(
  bundle: unknown,
  options: { anchor?: boolean; algorand?: AlgorandClient },
): Promise<VerifyReport> {
  const report = verifyBlockOffline(bundle);
  if (!options.anchor || !report.ok || !options.algorand || !isAnchored(bundle)) {
    return report;
  }
  try {
    const txn = await fetchIndexerTransaction(options.algorand.client.indexer, bundle.anchor.txnId);
    const note = noteText(txn);
    const matches = note === bundle.anchor.note && Number(txn["confirmed-round"]) === bundle.anchor.round;
    report.checks.push({
      name: "anchor",
      ok: matches,
      reason: matches
        ? "The Algorand note matches this block attestation."
        : "The Algorand note does not match this block attestation.",
    });
    report.ok = report.checks.every((check) => check.ok);
  } catch (error) {
    report.checks.push({
      name: "anchor",
      ok: false,
      reason: error instanceof Error ? error.message : "The anchor transaction could not be fetched.",
    });
    report.ok = false;
  }
  return report;
}

function isAnchored(bundle: unknown): bundle is BlockAttestBundle {
  return !!bundle && typeof bundle === "object" && "anchor" in bundle;
}

async function loadAccepts(
  config: PaymentConfig,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): Promise<PaymentAccept[]> {
  const accepts: PaymentAccept[] = [];
  const errors: string[] = [];
  if (config.payTo) {
    try {
      const feePayer = await loadFeePayer(config.facilitatorUrl, fetchImpl);
      accepts.push(algorandAccept(config, feePayer));
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  if (config.payToBase) {
    const extra = await loadBaseExtra(config.facilitatorUrl, fetchImpl);
    accepts.push(baseAccept(config, extra));
  }
  if (config.payToSolana) {
    try {
      const feePayer = await loadSolanaFeePayer(config.facilitatorUrl, fetchImpl);
      accepts.push(solanaAccept(config, feePayer));
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  if (accepts.length === 0) {
    throw new Error(errors.join(" ") || "No payment rail is available.");
  }
  return accepts;
}

function paymentRequiredResponse(required: PaymentRequired, message = "Payment Required"): Response {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("PAYMENT-REQUIRED", encodeHeaderJson(required));
  return new Response(JSON.stringify({ error: message }), { status: 402, headers });
}

async function handleAttest(
  source: { txid: string; chain: SourceChain },
  deps: ApiDeps,
  env: NodeJS.ProcessEnv,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): Promise<Response> {
  try {
    const algorand = deps.createClient();
    await deps.assertMainNet(algorand);
    const bundle = await deps.attest({
      algorand,
      txid: source.txid,
      chain: source.chain,
      mnemonic: env.ATTESTOR_MNEMONIC,
      falconSeed: env.ATTESTOR_FALCON_SEED,
      fetchImpl,
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
    const verified = await deps.verify(parsed, { chain, algorand, fetchImpl: deps.fetch });
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

function text(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
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
