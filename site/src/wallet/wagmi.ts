import { QueryClient } from "@tanstack/react-query";
import { createConfig, http, type Config } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

const CONFIG_KEY = "__pqAttestWagmiConfig";
const QUERY_KEY = "__pqAttestQueryClient";

type ConfigScope = typeof globalThis & { [CONFIG_KEY]?: Config };
type QueryScope = typeof globalThis & { [QUERY_KEY]?: QueryClient };

export const APP_NAME = "PQ Attest";
export const APP_URL = "https://pqattest.com";

/** One wagmi config for the page. Reconnect stays off until the user picks Base. */
export function getWagmiConfig(): Config {
  const current = globalThis as ConfigScope;
  if (!current[CONFIG_KEY]) {
    const projectId = walletConnectProjectId();
    current[CONFIG_KEY] = createConfig({
      chains: [base],
      connectors: [
        injected(),
        coinbaseWallet({ appName: APP_NAME }),
        ...(projectId ? [walletConnect({ projectId })] : []),
      ],
      transports: {
        [base.id]: http("https://mainnet.base.org"),
      },
      multiInjectedProviderDiscovery: true,
      ssr: false,
    });
  }
  return current[CONFIG_KEY];
}

export function getQueryClient(): QueryClient {
  const current = globalThis as QueryScope;
  if (!current[QUERY_KEY]) {
    current[QUERY_KEY] = new QueryClient();
  }
  return current[QUERY_KEY];
}

export function walletConnectProjectId(): string | undefined {
  const env = import.meta.env as ImportMetaEnv & { PUBLIC_WALLETCONNECT_PROJECT_ID?: string };
  const value = env.PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  return value || undefined;
}
