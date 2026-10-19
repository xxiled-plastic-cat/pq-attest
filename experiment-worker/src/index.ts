import { previewBundle, previewDocument, previewEthereumDocument } from "./document.js";
import { corsHeaders, jsonResponse } from "./http.js";
import { BitcoinBlockRun, EthereumBlockRun, ethereumStub, experimentStub, type ExperimentEnv } from "./object.js";

export { BitcoinBlockRun, EthereumBlockRun };

export default {
  async fetch(request: Request, env: ExperimentEnv): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, request);
    }

    const url = new URL(request.url);
    const match = matchRoute(url.pathname);
    if (!match) {
      return jsonResponse({ error: "Not found." }, 404, request);
    }
    try {
      if (match.height === null) {
        const document =
          env.EXPERIMENT_PREVIEW === "1"
            ? match.chain === "ethereum"
              ? previewEthereumDocument(new Date())
              : previewDocument(new Date())
            : match.chain === "ethereum"
              ? await ethereumStub(env).snapshot()
              : await experimentStub(env).snapshot();
        return jsonResponse(document, 200, request);
      }
      const bundle =
        env.EXPERIMENT_PREVIEW === "1"
          ? previewBundle(match.height, match.chain)
          : match.chain === "ethereum"
            ? await ethereumStub(env).bundle(match.height)
            : await experimentStub(env).bundle(match.height);
      if (!bundle) {
        return jsonResponse({ error: "No bundle for that height." }, 404, request);
      }
      return jsonResponse(bundle, 200, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Experiment read failed.";
      console.error(JSON.stringify({ event: "experiment_read_failed", message }));
      return jsonResponse({ error: message }, 500, request);
    }
  },

  async scheduled(_controller: ScheduledController, env: ExperimentEnv): Promise<void> {
    if (env.EXPERIMENT_PREVIEW === "1") {
      console.log(JSON.stringify({ event: "experiment_tick", skipped: "preview" }));
      return;
    }
    try {
      await ethereumStub(env).kick();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "experiment_tick_failed",
          chain: "ethereum",
          message: error instanceof Error ? error.message : "Tick failed.",
        }),
      );
      throw error;
    }
  },
};

function matchRoute(pathname: string): { chain: "bitcoin" | "ethereum"; height: number | null } | null {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/") {
    return { chain: "bitcoin", height: null };
  }
  if (path === "/ethereum") {
    return { chain: "ethereum", height: null };
  }
  const ethereum = /^\/ethereum\/attestations\/([0-9]+)$/.exec(path);
  if (ethereum?.[1]) {
    return { chain: "ethereum", height: Number(ethereum[1]) };
  }
  const bitcoin = /^\/attestations\/([0-9]+)$/.exec(path);
  if (bitcoin?.[1]) {
    return { chain: "bitcoin", height: Number(bitcoin[1]) };
  }
  return null;
}
