import { previewBundle, previewDocument } from "./document.js";
import { corsHeaders, jsonResponse } from "./http.js";
import { BitcoinBlockRun, experimentStub, type ExperimentEnv } from "./object.js";

export { BitcoinBlockRun };

export default {
  async fetch(request: Request, env: ExperimentEnv): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, request);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/") {
        const document =
          env.EXPERIMENT_PREVIEW === "1" ? previewDocument(new Date()) : await experimentStub(env).snapshot();
        return jsonResponse(document, 200, request);
      }
      const match = /^\/attestations\/([0-9]+)$/.exec(url.pathname);
      if (match?.[1]) {
        const height = Number(match[1]);
        const bundle =
          env.EXPERIMENT_PREVIEW === "1" ? previewBundle(height) : await experimentStub(env).bundle(height);
        if (!bundle) {
          return jsonResponse({ error: "No bundle for that height." }, 404, request);
        }
        return jsonResponse(bundle, 200, request);
      }
      return jsonResponse({ error: "Not found." }, 404, request);
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
      await experimentStub(env).tick();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "experiment_tick_failed",
          message: error instanceof Error ? error.message : "Tick failed.",
        }),
      );
      throw error;
    }
  },
};
