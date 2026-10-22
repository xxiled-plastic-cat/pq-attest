import {
  ETHEREUM_PROFILE,
  ETHEREUM_RUN_2_PROFILE,
  previewBundle,
  previewDocument,
  previewEthereumDocument,
  type ExperimentDocument,
} from "./document.js";
import { corsHeaders, jsonResponse } from "./http.js";
import { BitcoinBlockRun, EthereumBlockRun, ethereumStub, experimentStub, type ExperimentEnv } from "./object.js";
import { matchRoute } from "./routes.js";

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
    if (!match || (match.archive && archiveEpoch(env).length === 0)) {
      return jsonResponse({ error: "Not found." }, 404, request);
    }
    try {
      if (match.height === null) {
        const document =
          env.EXPERIMENT_PREVIEW === "1"
            ? match.chain === "ethereum"
              ? previewEthereumDocument(new Date(), match.archive ? ETHEREUM_PROFILE : ETHEREUM_RUN_2_PROFILE)
              : previewDocument(new Date())
            : match.chain === "ethereum"
              ? await ethereumDocument(env, match.archive)
              : await experimentStub(env).snapshot();
        return jsonResponse(document, 200, request);
      }
      const bundle =
        env.EXPERIMENT_PREVIEW === "1"
          ? previewBundle(match.height, match.chain)
          : match.chain === "ethereum"
            ? await ethereumReader(env, match.archive).bundle(match.height)
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

function archiveEpoch(env: ExperimentEnv): string {
  return env.ETHEREUM_EXPERIMENT_ARCHIVE_EPOCH?.trim() ?? "";
}

function ethereumReader(env: ExperimentEnv, archive: boolean): DurableObjectStub<EthereumBlockRun> {
  if (archive) {
    return ethereumStub(env, archiveEpoch(env));
  }
  return ethereumStub(env);
}

function ethereumDocument(env: ExperimentEnv, archive: boolean): Promise<ExperimentDocument> {
  if (archive) {
    return ethereumReader(env, true).snapshot(ETHEREUM_PROFILE, "stop");
  }
  return ethereumStub(env).snapshot(ETHEREUM_RUN_2_PROFILE);
}
