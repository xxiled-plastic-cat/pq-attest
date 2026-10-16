/** Contact is still a placeholder. API and MCP hosts are live. */
export const links = {
  apiBase: "https://api.pqattest.com",
  mcp: "https://mcp.pqattest.com/mcp",
  experiments: "https://experiments.pqattest.com",
  experimentsFallback: "https://pq-attest-experiment.kierantnelson.workers.dev",
  contact: "mailto:hello@pqattest.example",
  x402: "https://www.x402.org",
} as const;

export const openApiUrl = `${links.apiBase}/openapi.json`;
export const discoveryUrl = `${links.apiBase}/discovery`;
