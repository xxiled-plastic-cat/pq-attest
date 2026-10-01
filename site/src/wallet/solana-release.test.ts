import { afterEach, describe, expect, it, vi } from "vitest";
import { releaseSolanaSession } from "./solana-release";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("releaseSolanaSession", () => {
  it("disconnects through the connector and drops the saved session", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    values.set("connector-kit:v1:wallet", JSON.stringify("Phantom"));
    const disconnectWallet = vi.fn(async () => undefined);
    const phantomDisconnect = vi.fn(async () => undefined);
    const resetStorage = vi.fn();
    vi.stubGlobal("window", {
      phantom: { solana: { disconnect: phantomDisconnect } },
      __connectorClient: {
        disconnectWallet,
        resetStorage,
      },
      addEventListener: () => undefined,
      dispatchEvent: () => true,
    });
    await releaseSolanaSession();
    expect(disconnectWallet).toHaveBeenCalledOnce();
    expect(phantomDisconnect).not.toHaveBeenCalled();
    expect(resetStorage).toHaveBeenCalledOnce();
    expect(values.get("connector-kit:v1:wallet")).toBeUndefined();
  });
});
