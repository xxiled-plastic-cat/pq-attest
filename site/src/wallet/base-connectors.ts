import type { Connector } from "wagmi";

const COINBASE_RDNS = "com.coinbase.wallet";
const COINBASE_SDK_ID = "coinbaseWalletSDK";

/** Keep one Coinbase entry. The SDK connector shares the extension's rdns, so it is not treated as the extension. */
export function visibleBaseConnectors(connectors: readonly Connector[]): Connector[] {
  const hasCoinbaseExtension = connectors.some((connector) => isCoinbaseExtension(connector));
  const hasNamedInjected = connectors.some((connector) => connector.type === "injected" && connector.id !== "injected");
  return connectors.filter((connector) => {
    if (connector.id === COINBASE_SDK_ID && hasCoinbaseExtension) {
      return false;
    }
    if (connector.id === "injected" && hasNamedInjected) {
      return false;
    }
    return true;
  });
}

function isCoinbaseExtension(connector: Connector): boolean {
  if (connector.id === COINBASE_SDK_ID) {
    return false;
  }
  if (connector.id === COINBASE_RDNS) {
    return true;
  }
  const rdns = connector.rdns;
  if (typeof rdns === "string") {
    return rdns === COINBASE_RDNS;
  }
  return Array.isArray(rdns) && rdns.includes(COINBASE_RDNS);
}
