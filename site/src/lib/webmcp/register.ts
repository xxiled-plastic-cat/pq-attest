import { WEBMCP_TOOLS } from "./catalog";
import { executePqAttestWebMcpTool } from "./execute";
import { getModelContext, isOriginIsolated } from "./model-context";
import type { ModelContext, WebMcpRegistrationStatus } from "./types";

export interface RegisterPqAttestWebMcpToolsOptions {
  apiBaseUrl: string;
  modelContext?: ModelContext | null;
  signal?: AbortSignal;
  execute?: typeof executePqAttestWebMcpTool;
}

export async function registerPqAttestWebMcpTools(
  options: RegisterPqAttestWebMcpToolsOptions,
): Promise<WebMcpRegistrationStatus> {
  const originIsolated = isOriginIsolated();
  const resolved =
    options.modelContext === undefined
      ? getModelContext()
      : options.modelContext
        ? { api: "document.modelContext" as const, context: options.modelContext }
        : null;

  if (!resolved) {
    return {
      api: "unavailable",
      originIsolated,
      registered: [],
      failed: [],
    };
  }

  const execute = options.execute ?? executePqAttestWebMcpTool;
  const registered: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const tool of WEBMCP_TOOLS) {
    try {
      await resolved.context.registerTool(
        {
          name: tool.name,
          title: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          execute: async (args, extras) =>
            execute(tool.name, args, {
              apiBaseUrl: options.apiBaseUrl,
              signal: extras?.signal ?? options.signal,
            }),
        },
        options.signal ? { signal: options.signal } : undefined,
      );
      registered.push(tool.name);
    } catch (error) {
      failed.push({
        name: tool.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    api: resolved.api,
    originIsolated,
    registered,
    failed,
  };
}
