import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { microUsdcToUsdc, type PaidCallResult, ApiClientError } from "./client.js";

const FALLBACK_ATTEST_PRICE_USDC = "0.0001";

interface PaidRequestContext {
  path: string;
  method: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: unknown;
}

export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

export function errorResult(error: unknown): CallToolResult {
  if (error instanceof ApiClientError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "API_CLIENT_ERROR",
              message: error.message,
              status: error.status,
              bodySnippet: error.bodySnippet
            },
            null,
            2
          )
        }
      ]
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: "INTERNAL_ERROR", message }, null, 2)
      }
    ]
  };
}

export function paidToolResult(result: PaidCallResult, request: PaidRequestContext): CallToolResult {
  const accepted = result.paymentRequired?.accepts?.[0];
  const priceUsdc =
    accepted?.priceUsdc ?? microUsdcToUsdc(accepted?.maxAmountRequired ?? accepted?.amount) ?? FALLBACK_ATTEST_PRICE_USDC;

  const payment = {
    required: result.status === 402,
    priceUsdc,
    paymentRequiredHeader: result.paymentRequiredHeader,
    paymentRequired: result.paymentRequired,
    paymentResponseHeader: result.paymentResponseHeader,
    paymentResponsePresent: Boolean(result.paymentResponseHeader)
  };

  if (result.status === 402) {
    return jsonResult({
      error: "PAYMENT_REQUIRED",
      message: "Sign PAYMENT-REQUIRED and retry this tool call with paymentSignature.",
      mcpPayment: payment,
      request,
      retry: {
        arg: "paymentSignature",
        header: "PAYMENT-SIGNATURE"
      },
      gatewayResponse: result.body
    });
  }

  if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
    return jsonResult({
      ...(result.body as Record<string, unknown>),
      mcpPayment: payment
    });
  }

  return jsonResult({
    data: result.body,
    mcpPayment: payment
  });
}
