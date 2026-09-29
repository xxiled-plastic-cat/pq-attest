import { afterEach, describe, expect, it, vi } from "vitest";
import { initialPayNetwork, readStoredPayNetwork, shouldRestoreBase, shouldRestoreSolana, storePayNetwork } from "./session-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pay network storage", () => {
  it("remembers the last network and forgets it on clear", () => {
    installStorage();
    expect(readStoredPayNetwork()).toBeNull();

    storePayNetwork("solana");
    expect(readStoredPayNetwork()).toBe("solana");

    storePayNetwork("base");
    expect(readStoredPayNetwork()).toBe("base");

    storePayNetwork(null);
    expect(readStoredPayNetwork()).toBeNull();
  });

  it("ignores a stored value that is not a pay network", () => {
    const storage = installStorage();
    storage.setItem("pq-attest:pay-network", "ethereum");
    expect(readStoredPayNetwork()).toBeNull();
  });

  it("restores Solana from a saved wallet when no network was chosen", () => {
    const storage = installStorage();
    storage.setItem("connector-kit:v1:wallet", JSON.stringify("Phantom"));
    expect(initialPayNetwork()).toBe("solana");
    expect(shouldRestoreSolana()).toBe(true);
    expect(shouldRestoreBase()).toBe(false);
  });

  it("keeps a saved Algorand wallet ahead of a leftover Solana wallet", () => {
    const storage = installStorage();
    storage.setItem("connector-kit:v1:wallet", JSON.stringify("Phantom"));
    storage.setItem("@txnlab/use-wallet:v5", JSON.stringify({ activeWallet: "lute" }));
    expect(initialPayNetwork()).toBeNull();
    expect(shouldRestoreSolana()).toBe(false);
    expect(shouldRestoreBase()).toBe(false);
  });

  it("reconnects Base only after Base was chosen", () => {
    installStorage();
    expect(shouldRestoreBase()).toBe(false);
    storePayNetwork("base");
    expect(shouldRestoreBase()).toBe(true);
    expect(shouldRestoreSolana()).toBe(false);
  });
});

function installStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}
