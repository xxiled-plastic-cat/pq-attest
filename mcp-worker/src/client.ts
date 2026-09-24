import { Buffer } from "node:buffer";

export type FetchFn = typeof fetch;

export interface ApiClientConfig {
  apiUrl: string;
}

export interface PaymentRequestAccept {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  amount?: string;
  maxAmountRequired?: string;
  priceUsdc?: string;
}

export interface PaymentRequest {
  x402Version?: number;
  accepts?: PaymentRequestAccept[];
  [key: string]: unknown;
}

export interface PaidCallResult {
  status: number;
  body: unknown;
  paymentRequired: PaymentRequest | null;
  paymentRequiredHeader: string | null;
  paymentResponseHeader: string | null;
}

export class ApiClientError extends Error {
  readonly status: number | undefined;
  readonly bodySnippet: string | undefined;

  constructor(message: string, status?: number, bodySnippet?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export interface FreeCallOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/**
 * Cloudflare Workers throws `Illegal invocation` if global `fetch` is captured
 * as a bare function reference and later called without its original receiver.
 */
export function resolveFetch(fetchImpl?: FetchFn): FetchFn {
  if (fetchImpl) return fetchImpl;
  return globalThis.fetch.bind(globalThis);
}

export class ApiClient {
  private readonly fetchImpl: FetchFn;

  constructor(
    private readonly config: ApiClientConfig,
    fetchImpl?: FetchFn
  ) {
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, `${this.config.apiUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async fetchFree(path: string, options?: FreeCallOptions): Promise<unknown> {
    const method = options?.method ?? (options?.body === undefined ? "GET" : "POST");
    const headers: Record<string, string> = {};
    let serializedBody: string | undefined;
    if (options?.body !== undefined) {
      headers["content-type"] = "application/json";
      serializedBody = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(this.buildUrl(path, options?.query), {
      method,
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody })
    });
    const bodyText = await response.text();
    if (response.status !== 200) {
      throw new ApiClientError(
        `${path}: expected 200, got ${response.status}`,
        response.status,
        bodyText.slice(0, 400)
      );
    }
    return bodyText.length === 0 ? null : (JSON.parse(bodyText) as unknown);
  }

  async fetchPaid(
    path: string,
    options?: {
      method?: "GET" | "POST";
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      paymentSignature?: string;
    }
  ): Promise<PaidCallResult> {
    const method = options?.method ?? (options?.body === undefined ? "GET" : "POST");
    const headers: Record<string, string> = {};
    let serializedBody: string | undefined;
    if (options?.body !== undefined) {
      headers["content-type"] = "application/json";
      serializedBody = JSON.stringify(options.body);
    }
    if (options?.paymentSignature) {
      headers["PAYMENT-SIGNATURE"] = options.paymentSignature;
    }

    const response = await this.fetchImpl(this.buildUrl(path, options?.query), {
      method,
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody })
    });
    const bodyText = await response.text();

    if (response.status !== 200 && response.status !== 402) {
      throw new ApiClientError(
        `${path}: expected 200 or 402, got ${response.status}`,
        response.status,
        bodyText.slice(0, 400)
      );
    }

    const paymentRequiredHeader = response.headers.get("payment-required");
    return {
      status: response.status,
      body: bodyText.length === 0 ? null : parseBodyOrText(bodyText),
      paymentRequired: paymentRequiredHeader ? decodePaymentRequiredHeader(paymentRequiredHeader) : null,
      paymentRequiredHeader,
      paymentResponseHeader: response.headers.get("payment-response")
    };
  }
}

function parseBodyOrText(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}

export function decodePaymentRequiredHeader(headerValue: string): PaymentRequest | null {
  try {
    const normalized = headerValue.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as PaymentRequest;
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
