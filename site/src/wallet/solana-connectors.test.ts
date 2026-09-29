import { describe, expect, it } from "vitest";
import { visibleSolanaConnectors } from "./solana-connectors";

describe("visibleSolanaConnectors", () => {
  const phantom = connector("wallet-standard:phantom", "Phantom", true);
  const walletConnect = connector("wallet-standard:walletconnect", "WalletConnect", true);
  const mobile = connector("mwa:phantom", "Phantom Mobile", true);

  it("lists installed wallets and WalletConnect when a project ID is set", () => {
    const names = visibleSolanaConnectors([walletConnect, phantom, mobile], true).map((item) => item.name);
    expect(names).toEqual(["Phantom", "Phantom Mobile", "WalletConnect"]);
  });

  it("keeps WalletConnect when it is the only connector", () => {
    const names = visibleSolanaConnectors([walletConnect], true).map((item) => item.name);
    expect(names).toEqual(["WalletConnect"]);
  });

  it("keeps WalletConnect before it reports ready", () => {
    const pending = connector("walletconnect", "WalletConnect", false);
    const names = visibleSolanaConnectors([pending], true).map((item) => item.id);
    expect(names).toEqual(["walletconnect"]);
  });

  it("hides WalletConnect when no project ID is set", () => {
    const names = visibleSolanaConnectors([phantom, walletConnect], false).map((item) => item.name);
    expect(names).toEqual(["Phantom"]);
  });
});

function connector(id: string, name: string, ready: boolean) {
  return { id, name, ready };
}
