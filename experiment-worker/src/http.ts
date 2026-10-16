const SITE_ORIGINS = new Set(["https://pqattest.com", "https://www.pqattest.com"]);

export function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  if (origin && (SITE_ORIGINS.has(origin) || isLocalOrigin(origin))) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
  }
  headers.set("access-control-allow-methods", "GET, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("cache-control", "no-store");
  return headers;
}

export function jsonResponse(body: unknown, status: number, request: Request): Response {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
