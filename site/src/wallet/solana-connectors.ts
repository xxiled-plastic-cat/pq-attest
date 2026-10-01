const WALLET_CONNECT_IDS = new Set(["walletconnect", "wallet-standard:walletconnect"]);

/** ConnectorKit registers WalletConnect under one of these ids. */
export function isSolanaWalletConnect(connector: { id: string }): boolean {
  return WALLET_CONNECT_IDS.has(connector.id);
}

/**
 * Installed Wallet Standard wallets, plus WalletConnect when a project ID is set.
 * WalletConnect stays in the list even when no browser extension is installed.
 */
export function visibleSolanaConnectors<T extends { id: string; ready: boolean }>(
  connectors: readonly T[],
  walletConnectEnabled: boolean,
): T[] {
  const installed = connectors.filter((connector) => connector.ready && !isSolanaWalletConnect(connector));
  if (!walletConnectEnabled) {
    return installed;
  }
  const walletConnect = connectors.find((connector) => isSolanaWalletConnect(connector));
  if (!walletConnect) {
    return installed;
  }
  return [...installed, walletConnect];
}
