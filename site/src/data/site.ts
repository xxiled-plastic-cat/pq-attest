/** Placeholder hosts. Replace when the real API and docs are published. */
export const links = {
  apiBase: "https://api.pqattest.example",
  docs: "https://docs.pqattest.example",
  contact: "mailto:hello@pqattest.example",
  x402: "https://www.x402.org",
} as const;

export const openApiUrl = `${links.apiBase}/openapi.json`;
export const discoveryUrl = `${links.apiBase}/discovery`;
