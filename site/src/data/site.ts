/** Docs and contact are still placeholders. API and MCP hosts are live. */
export const links = {
  apiBase: "https://api.pqattest.com",
  mcp: "https://mcp.pqattest.com/mcp",
  docs: "https://docs.pqattest.example",
  contact: "mailto:hello@pqattest.example",
  x402: "https://www.x402.org",
} as const;

export const openApiUrl = `${links.apiBase}/openapi.json`;
export const discoveryUrl = `${links.apiBase}/discovery`;
