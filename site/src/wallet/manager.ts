import { Buffer } from "buffer";
import { NetworkId, WalletManager } from "@txnlab/use-wallet";
import { lute } from "@txnlab/use-wallet-lute";
import { pera } from "@txnlab/use-wallet-pera";

const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!scope.Buffer) {
  scope.Buffer = Buffer;
}

const MANAGER_KEY = "__pqAttestWalletManager";

type Scope = typeof globalThis & { [MANAGER_KEY]?: WalletManager };

/** One manager for the page, created on the client so wallet storage is available. */
export function getWalletManager(): WalletManager {
  const current = globalThis as Scope;
  if (!current[MANAGER_KEY]) {
    current[MANAGER_KEY] = new WalletManager({
      wallets: [lute({ siteName: "PQ Attest" }), pera()],
      defaultNetwork: NetworkId.MAINNET,
    });
  }
  return current[MANAGER_KEY];
}
