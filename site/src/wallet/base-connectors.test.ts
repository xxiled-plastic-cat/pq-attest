import { describe, expect, it } from "vitest";
import type { Connector } from "wagmi";
import { visibleBaseConnectors } from "./base-connectors";

describe("visibleBaseConnectors", () => {
  it("keeps Coinbase Wallet when only the SDK connector is present", () => {
    const names = visibleBaseConnectors([
      connector("injected", "Injected", "injected"),
      connector("coinbaseWalletSDK", "Coinbase Wallet", "coinbaseWallet", "com.coinbase.wallet"),
    ]).map((item) => item.name);
    expect(names).toEqual(["Injected", "Coinbase Wallet"]);
  });

  it("hides the SDK when the Coinbase extension is already listed", () => {
    const names = visibleBaseConnectors([
      connector("com.coinbase.wallet", "Coinbase Wallet", "injected", "com.coinbase.wallet"),
      connector("coinbaseWalletSDK", "Coinbase Wallet", "coinbaseWallet", "com.coinbase.wallet"),
      connector("io.metamask", "MetaMask", "injected", "io.metamask"),
      connector("injected", "Injected", "injected"),
    ]).map((item) => item.name);
    expect(names).toEqual(["Coinbase Wallet", "MetaMask"]);
  });
});

function connector(id: string, name: string, type: string, rdns?: string): Connector {
  return { id, name, type, rdns, uid: id } as Connector;
}
