import { defaultDeps, handleHttp } from "../src/api.ts";

export interface Env {
  ATTESTOR_MNEMONIC?: string;
  ATTESTOR_FALCON_SEED?: string;
  ATTESTOR_PQ_SEED?: string;
  X402_PAY_TO?: string;
  ALGOD_URL?: string;
  ALGOD_TOKEN?: string;
  INDEXER_URL?: string;
  INDEXER_TOKEN?: string;
  X402_PRICE_ATTEST_USDC?: string;
  X402_NETWORK?: string;
  X402_SCHEME?: string;
  FACILITATOR_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    bindProcessEnv(env);
    try {
      return await handleHttp(request, defaultDeps(), process.env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gateway failed.";
      return Response.json({ error: message }, { status: 500 });
    }
  },
};

function bindProcessEnv(env: Env): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
}
