import { Container } from "@cloudflare/containers";

const PUBLIC_DEFAULTS = {
  ALGOD_URL: "https://mainnet-api.algonode.cloud/",
  INDEXER_URL: "https://mainnet-idx.algonode.cloud/",
  X402_PRICE_ATTEST_USDC: "0.0001",
  X402_NETWORK: "algorand-mainnet",
  X402_SCHEME: "exact",
  FACILITATOR_URL: "https://facilitator.goplausible.xyz",
  CADDY_SITE_ADDRESS: ":8080",
  PORT: "3000",
} as const;

export class PqAttestContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "10m";
  enableInternet = true;
  pingEndpoint = "/health";
}

export interface Env {
  PQ_ATTEST: DurableObjectNamespace<PqAttestContainer>;
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
    try {
      const container = env.PQ_ATTEST.getByName("singleton");
      await container.startAndWaitForPorts({
        ports: [8080],
        cancellationOptions: {
          instanceGetTimeoutMS: 60_000,
          portReadyTimeoutMS: 60_000,
        },
        startOptions: {
          envVars: containerEnv(env),
        },
      });
      return container.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gateway failed to start.";
      return Response.json({ error: message }, { status: 500 });
    }
  },
};

function containerEnv(env: Env): Record<string, string> {
  const payTo = required(env.X402_PAY_TO, "X402_PAY_TO");
  const mnemonic = required(env.ATTESTOR_MNEMONIC, "ATTESTOR_MNEMONIC");
  const falconSeed = required(env.ATTESTOR_FALCON_SEED, "ATTESTOR_FALCON_SEED");
  const vars: Record<string, string> = {
    ...PUBLIC_DEFAULTS,
    X402_PAY_TO: payTo,
    ATTESTOR_MNEMONIC: mnemonic,
    ATTESTOR_FALCON_SEED: falconSeed,
  };
  copyIfSet(vars, "ATTESTOR_PQ_SEED", env.ATTESTOR_PQ_SEED);
  copyIfSet(vars, "ALGOD_URL", env.ALGOD_URL);
  copyIfSet(vars, "ALGOD_TOKEN", env.ALGOD_TOKEN);
  copyIfSet(vars, "INDEXER_URL", env.INDEXER_URL);
  copyIfSet(vars, "INDEXER_TOKEN", env.INDEXER_TOKEN);
  copyIfSet(vars, "X402_PRICE_ATTEST_USDC", env.X402_PRICE_ATTEST_USDC);
  copyIfSet(vars, "X402_NETWORK", env.X402_NETWORK);
  copyIfSet(vars, "X402_SCHEME", env.X402_SCHEME);
  copyIfSet(vars, "FACILITATOR_URL", env.FACILITATOR_URL);
  return vars;
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`Missing ${name}. Set it with wrangler secret put ${name}.`);
  }
  return trimmed;
}

function copyIfSet(target: Record<string, string>, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    target[key] = trimmed;
  }
}
