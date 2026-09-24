import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { loadWorkerConfig, type WorkerEnv } from "./config.js";
import { createPqAttestMcpServer } from "./server.js";

function mcpDiscovery(publicUrl: string) {
  return {
    name: "pq-attest",
    description: "MCP server for pq-attest. pq_attest is paid through the API. pq_verify is free.",
    transport: "streamable-http",
    url: publicUrl,
    tools: [
      { name: "pq_attest", description: "Attest a confirmed transaction. Paid per call in USDC (x402)." },
      { name: "pq_verify", description: "Verify an ML-DSA-65 proof bundle. Free." }
    ]
  };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const config = loadWorkerConfig(env, request.url);

    if (url.pathname === "/health" || url.pathname === "/") {
      return Response.json({
        ok: true,
        service: "pq-attest-mcp",
        transport: "streamable-http",
        apiUrl: config.apiUrl
      });
    }

    if (url.pathname === "/.well-known/mcp" || url.pathname === "/.well-known/mcp.json") {
      return Response.json(mcpDiscovery(config.publicUrl));
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    // Stateless Workers cannot usefully hold a standalone GET SSE stream: the
    // ReadableStream never receives events, so Cloudflare cancels the request
    // as hung. The Streamable HTTP spec allows declining GET with 405 when
    // the server does not offer SSE.
    if (request.method === "GET") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST, DELETE" }
      });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true
    });
    const server = createPqAttestMcpServer({
      config,
      fetchImpl: globalThis.fetch.bind(globalThis)
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  }
};
