/** JSON Schema object accepted by the WebMCP Imperative API `inputSchema`. */
export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
}

export interface WebMcpToolHttp {
  method: "GET" | "POST";
  path: string;
  queryParams?: string[];
}

export interface WebMcpToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  access: "free" | "paid";
  fallbackPriceUsdc?: string;
  http: WebMcpToolHttp;
}

export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchemaObject;
  execute: (
    args: unknown,
    extras?: { signal?: AbortSignal },
  ) => Promise<unknown> | unknown;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
}

export interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void> | void;
  getTools?(options?: { fromOrigins?: string[] }): Promise<unknown[]>;
}

export type WebMcpApiSurface =
  | "document.modelContext"
  | "navigator.modelContext"
  | "unavailable";

export interface WebMcpRegistrationStatus {
  api: WebMcpApiSurface;
  originIsolated: boolean;
  registered: string[];
  failed: Array<{ name: string; error: string }>;
}

export interface ApiCallResult {
  status: number;
  body: unknown;
  paymentRequiredHeader: string | null;
  paymentResponseHeader: string | null;
  paymentRequired: Record<string, unknown> | null;
}
