import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { defaultDeps, handleHttp, type ApiDeps } from "./api.ts";
import { loadDotEnv } from "./env.ts";

const HOST = "127.0.0.1";

export type { ApiDeps };
export { defaultDeps, handleHttp };

export function listenPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535, got ${raw}.`);
  }
  return port;
}

export function startServer(deps: ApiDeps = defaultDeps(), port = listenPort()): Server {
  const server = createServer((req, res) => {
    void serve(req, res, deps);
  });
  server.listen(port, HOST);
  return server;
}

async function serve(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<void> {
  try {
    const request = toWebRequest(req);
    const response = await handleHttp(request, deps);
    const headers = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, headers);
    const body = Buffer.from(await response.arrayBuffer());
    res.end(body);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(500, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({ error: message }));
  }
}

function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? `${HOST}:${listenPort()}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    }
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  loadDotEnv();
  startServer();
}
