import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { attestTransaction, verifyBundle } from "./bundle.ts";
import { assertMainNet, createAlgorandClient } from "./client.ts";
import { loadDotEnv } from "./env.ts";
import { discoveryDocument, loadPaymentConfig, openApiDocument } from "./policy.ts";
import type { ProofBundle, UnsignedBundle } from "./types.ts";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const HOST = "127.0.0.1";
const TXID = /^[A-Z2-7]{52}$/;

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
}

export function defaultDeps(): ApiDeps {
  return {
    attest: attestTransaction,
    verify: verifyBundle,
    createClient: createAlgorandClient,
    assertMainNet,
  };
}

export function listenPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535, got ${raw}.`);
  }
  return port;
}

export async function handleHttp(
  request: Request,
  deps: ApiDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;

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
    return handleAttest(request, deps, env);
  }

  return json(404, { error: "Not found" });
}

export function startServer(deps: ApiDeps = defaultDeps(), port = listenPort()): Server {
  const server = createServer((req, res) => {
    void serve(req, res, deps);
  });
  server.listen(port, HOST);
  return server;
}

async function serve(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<void> {
  try {
    const request = toWebRequest(req);
    const response = await handleHttp(request, deps);
    const headers = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, headers);
    const body = Buffer.from(await response.arrayBuffer());
    res.end(body);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: errorMessage(error) }));
  }
}

function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? `${HOST}:${listenPort()}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    }
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  loadDotEnv();
  startServer();
}
