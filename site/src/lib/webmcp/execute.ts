import { chains, type ChainId } from "../../data/chains";
import { getWebMcpTool } from "./catalog";
import type { ApiCallResult, WebMcpToolSpec } from "./types";

export interface ExecutePqAttestToolOptions {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const TXID = /^[A-Za-z0-9+/=_@.-]{32,128}$/;
const FALLBACK_ATTEST_PRICE_USDC = "0.001";

const CHAIN_IDS = new Set<string>(chains.map((chain) => chain.id));

export function stringifyToolResult(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function normalizeToolArgs(input: unknown): Record<string, unknown> {
  if (input == null) {
    return {};
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed === "") {
      return {};
    }
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw Object.assign(new Error("Tool arguments must be a JSON object."), {
        code: "INVALID_ARGUMENT",
      });
    }
    return parsed as Record<string, unknown>;
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  throw Object.assign(new Error("Tool arguments must be a JSON object."), {
    code: "INVALID_ARGUMENT",
  });
}

export async function executePqAttestWebMcpTool(
  name: string,
  rawArgs: unknown,
  options: ExecutePqAttestToolOptions,
): Promise<string> {
  try {
    return stringifyToolResult(await executePqAttestWebMcpToolValue(name, rawArgs, options));
  } catch (error) {
    return stringifyToolResult(errorPayload(error));
  }
}

export async function executePqAttestWebMcpToolValue(
  name: string,
  rawArgs: unknown,
  options: ExecutePqAttestToolOptions,
): Promise<unknown> {
  const tool = getWebMcpTool(name);
  if (!tool) {
    return {
      error: "UNKNOWN_TOOL",
      message: `Unknown PQ Attest WebMCP tool: ${name}`,
    };
  }

  let args: Record<string, unknown>;
  try {
    args = normalizeToolArgs(rawArgs);
  } catch (error) {
    return errorPayload(error);
  }

  const request = buildRequest(tool, args, options.apiBaseUrl);
  if ("error" in request) {
    return request;
  }

  const result = await callApi(request, {
    fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
    signal: options.signal,
  });

  return mapApiResult(tool, result, request);
}

interface BuiltRequest {
  method: "POST";
  path: string;
  url: string;
  query?: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

function buildRequest(
  tool: WebMcpToolSpec,
  args: Record<string, unknown>,
  apiBaseUrl: string,
): BuiltRequest | { error: string; message: string; argument?: string } {
  if (tool.name === "pq_attest") {
    const txid = requiredString(args, "txid");
    if (typeof txid !== "string") {
      return txid;
    }
    if (!TXID.test(txid)) {
      return {
        error: "INVALID_ARGUMENT",
        message: "txid must be a transaction id.",
        argument: "txid",
      };
    }
    const chain = requiredString(args, "chain");
    if (typeof chain !== "string") {
      return chain;
    }
    if (!CHAIN_IDS.has(chain)) {
      return {
        error: "INVALID_ARGUMENT",
        message: "chain must be a supported source chain.",
        argument: "chain",
      };
    }
    const paymentSignature =
      typeof args.paymentSignature === "string" && args.paymentSignature.length > 0
        ? args.paymentSignature
        : undefined;
    const body = { txid, chain: chain as ChainId };
    return {
      method: "POST",
      path: tool.http.path,
      url: buildUrl(apiBaseUrl, tool.http.path),
      body,
      headers: paymentSignature ? { "PAYMENT-SIGNATURE": paymentSignature } : {},
    };
  }

  if (tool.name === "pq_attest_block" || tool.name === "pq_prove_tx_inclusion") {
    const chain = requiredString(args, "chain");
    if (typeof chain !== "string") {
      return chain;
    }
    if (!CHAIN_IDS.has(chain)) {
      return { error: "INVALID_ARGUMENT", message: "chain must be a supported source chain.", argument: "chain" };
    }
    const paymentSignature =
      typeof args.paymentSignature === "string" && args.paymentSignature.length > 0 ? args.paymentSignature : undefined;
    const body =
      tool.name === "pq_attest_block"
        ? { chain, height: args.height, ...(args.blockHash ? { blockHash: args.blockHash } : {}) }
        : { chain, txId: args.txId, ...(args.height != null && args.height !== "" ? { height: args.height } : {}) };
    return {
      method: "POST",
      path: tool.http.path,
      url: buildUrl(apiBaseUrl, tool.http.path),
      body,
      headers: paymentSignature ? { "PAYMENT-SIGNATURE": paymentSignature } : {},
    };
  }

  if (tool.name === "pq_verify_tx_inclusion") {
    const proof = args.proof;
    if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
      return { error: "INVALID_ARGUMENT", message: "proof (object) is required.", argument: "proof" };
    }
    return {
      method: "POST",
      path: tool.http.path,
      url: buildUrl(apiBaseUrl, tool.http.path),
      body: proof,
      headers: {},
    };
  }

  const bundle = args.bundle;
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return {
      error: "INVALID_ARGUMENT",
      message: "bundle (object) is required.",
      argument: "bundle",
    };
  }
  if (args.chain !== undefined && typeof args.chain !== "boolean") {
    return {
      error: "INVALID_ARGUMENT",
      message: "chain must be a boolean.",
      argument: "chain",
    };
  }
  const query = args.chain === true ? { chain: "1" } : undefined;
  return {
    method: "POST",
    path: tool.http.path,
    url: buildUrl(apiBaseUrl, tool.http.path, query),
    query,
    body: bundle,
    headers: {},
  };
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
): string | { error: string; message: string; argument: string } {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    return {
      error: "INVALID_ARGUMENT",
      message: `${key} (string) is required.`,
      argument: key,
    };
  }
  return value.trim();
}

function buildUrl(apiBaseUrl: string, path: string, query?: Record<string, string>): string {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL(path.replace(/^\//, ""), base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function callApi(
  request: BuiltRequest,
  options: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<ApiCallResult> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    ...request.headers,
  };
  const response = await options.fetchImpl(request.url, {
    method: request.method,
    headers,
    signal: options.signal,
    body: JSON.stringify(request.body),
  });
  const bodyText = await response.text();
  const paymentRequiredHeader = response.headers.get("payment-required");
  return {
    status: response.status,
    body: bodyText.length === 0 ? null : parseBodyOrText(bodyText),
    paymentRequiredHeader,
    paymentResponseHeader: response.headers.get("payment-response"),
    paymentRequired: paymentRequiredHeader ? decodePaymentRequiredHeader(paymentRequiredHeader) : null,
  };
}

function mapApiResult(tool: WebMcpToolSpec, result: ApiCallResult, request: BuiltRequest): unknown {
  const expectsPayment = tool.access === "paid";
  if (!expectsPayment && result.status !== 200) {
    return apiClientError(request.path, result);
  }
  if (expectsPayment && result.status !== 200 && result.status !== 402) {
    return apiClientError(request.path, result);
  }

  if (result.status === 402) {
    return paymentRequiredResult(tool, result, request);
  }

  if (expectsPayment) {
    const mcpPayment = paymentMeta(tool, result, false);
    if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
      return { ...(result.body as Record<string, unknown>), mcpPayment };
    }
    return { data: result.body, mcpPayment };
  }

  return result.body;
}

function paymentRequiredResult(tool: WebMcpToolSpec, result: ApiCallResult, request: BuiltRequest): unknown {
  return {
    error: "PAYMENT_REQUIRED",
    message: "Sign PAYMENT-REQUIRED and retry this tool call with paymentSignature.",
    mcpPayment: paymentMeta(tool, result, true),
    request: {
      path: request.path,
      method: request.method,
      ...(request.query ? { query: request.query } : {}),
      body: request.body,
    },
    retry: {
      arg: "paymentSignature",
      header: "PAYMENT-SIGNATURE",
    },
    gatewayResponse: result.body,
  };
}

function paymentMeta(tool: WebMcpToolSpec, result: ApiCallResult, required: boolean) {
  const accepts = Array.isArray(result.paymentRequired?.accepts) ? result.paymentRequired.accepts : [];
  const accepted = accepts[0] as
    | { priceUsdc?: string; maxAmountRequired?: string; amount?: string }
    | undefined;
  const priceUsdc =
    accepted?.priceUsdc ??
    microUsdcToUsdc(accepted?.maxAmountRequired ?? accepted?.amount) ??
    tool.fallbackPriceUsdc ??
    FALLBACK_ATTEST_PRICE_USDC;
  return {
    required,
    priceUsdc,
    paymentRequiredHeader: result.paymentRequiredHeader,
    paymentRequired: result.paymentRequired,
    paymentResponseHeader: result.paymentResponseHeader,
    paymentResponsePresent: Boolean(result.paymentResponseHeader),
  };
}

function apiClientError(path: string, result: ApiCallResult) {
  return {
    error: "API_CLIENT_ERROR",
    message: `${path}: expected 200${path === "/attest" ? " or 402" : ""}, got ${result.status}`,
    status: result.status,
    bodySnippet: snippet(result.body),
  };
}

export function decodePaymentRequiredHeader(headerValue: string): Record<string, unknown> | null {
  try {
    const normalized = headerValue.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function microUsdcToUsdc(rawAmount: string | undefined): string | undefined {
  if (!rawAmount) return undefined;
  if (rawAmount.includes(".")) return rawAmount;
  try {
    const micro = BigInt(rawAmount);
    const whole = micro / 1_000_000n;
    const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  } catch {
    return rawAmount;
  }
}

function parseBodyOrText(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function snippet(body: unknown): string {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return raw.slice(0, 400);
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error && typeof error === "object" && "code" in error) {
    const named = error as { code?: string; message?: string };
    if (named.code === "INVALID_ARGUMENT") {
      return {
        error: "INVALID_ARGUMENT",
        message: named.message ?? "Invalid tool arguments.",
      };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: "INTERNAL_ERROR",
    message,
  };
}
