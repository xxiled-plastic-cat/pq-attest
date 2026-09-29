import { forgetSolanaWallet } from "./session-storage";

type ConnectorClient = {
  disconnectWallet?: () => Promise<unknown>;
  resetStorage?: () => void;
};

type SolanaWindow = Window & {
  __connectorClient?: ConnectorClient;
};

/** Disconnect the current Solana session and drop its saved wallet. */
export async function releaseSolanaSession(): Promise<void> {
  const client = solanaClient();
  try {
    await client?.disconnectWallet?.();
  } catch {
    /* The connector may already be disconnected. */
  }
  client?.resetStorage?.();
  forgetSolanaWallet();
}

function solanaClient(): ConnectorClient | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as SolanaWindow).__connectorClient;
}
