export interface WorkerEnv {
  PQ_ATTEST_API_URL?: string;
  PQ_ATTEST_MCP_PUBLIC_URL?: string;
}

export interface WorkerConfig {
  apiUrl: string;
  publicUrl: string;
}

const DEFAULT_API_URL = "https://api.pqattest.com";
const DEFAULT_PUBLIC_URL = "https://mcp.pqattest.com/mcp";

export function loadWorkerConfig(env: WorkerEnv, requestUrl?: string): WorkerConfig {
  const apiUrl = trimTrailingSlash(env.PQ_ATTEST_API_URL || DEFAULT_API_URL);
  const publicUrl = trimTrailingSlash(
    env.PQ_ATTEST_MCP_PUBLIC_URL ||
      (requestUrl ? `${new URL(requestUrl).origin}/mcp` : DEFAULT_PUBLIC_URL)
  );

  return { apiUrl, publicUrl };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
