import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { loadWorkerConfig, type WorkerEnv } from "./config.js";
import { createPqAttestMcpServer } from "./server.js";

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

    if (url.pathname === "/.well-known/mcp") {
      return Response.json({
        name: "pq-attest",
        transport: "streamable-http",
        url: config.publicUrl
      });
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
