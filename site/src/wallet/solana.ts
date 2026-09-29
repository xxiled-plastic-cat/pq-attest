import { getDefaultConfig, getDefaultMobileConfig, type ConnectorConfig } from "@solana/connector/headless";
import { SOLANA_RPC_URL } from "../lib/solana-balance";
import { shouldRestoreSolana } from "./session-storage";
import { APP_NAME, APP_URL, walletConnectProjectId } from "./wagmi";

const CONFIG_KEY = "__pqAttestSolanaConfig";

type Scope = typeof globalThis & { [CONFIG_KEY]?: ConnectorConfig };

/** Wallet Standard connectors for Solana mainnet. Reconnect only a saved Solana session. */
export function getSolanaConfig(): ConnectorConfig {
  const current = globalThis as Scope;
  if (!current[CONFIG_KEY]) {
    const projectId = walletConnectProjectId();
    current[CONFIG_KEY] = getDefaultConfig({
      appName: APP_NAME,
      appUrl: APP_URL,
      autoConnect: shouldRestoreSolana(),
      enableMobile: true,
      network: "mainnet",
      clusters: [{ id: "solana:mainnet", label: "Mainnet", url: SOLANA_RPC_URL }],
      wallets: {
        featured: ["Phantom", "Solflare", "Backpack"],
      },
      walletConnect: projectId ? { projectId } : false,
    });
  }
  return current[CONFIG_KEY];
}

export function getSolanaMobileConfig() {
  return getDefaultMobileConfig({
    appName: APP_NAME,
    appUrl: APP_URL,
    network: "mainnet",
  });
}
