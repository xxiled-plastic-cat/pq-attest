import { afterEach, describe, expect, it, vi } from "vitest";
import { SOLANA_USDC_ASSET } from "./pay-attest";
import { associatedTokenAddress, readSolanaTokenBalance, readSolanaUsdc } from "./solana-balance";

const OWNER = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";
const USDC_ACCOUNT = "3XZXfFJHF5ox3yPop16oqYfSWxLpkjsEuvTe2S67G2rj";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("associatedTokenAddress", () => {
  it("derives the USDC account for an owner", async () => {
    await expect(associatedTokenAddress(OWNER, SOLANA_USDC_ASSET)).resolves.toBe(USDC_ACCOUNT);
  });
});

describe("readSolanaTokenBalance", () => {
  it("reads the associated account with getAccountInfo", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: [string, unknown] };
      expect(body.method).toBe("getAccountInfo");
      expect(body.params[0]).toBe(USDC_ACCOUNT);
      return jsonResponse({
        result: {
          value: {
            data: { parsed: { info: { tokenAmount: { amount: "1000000" } } } },
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(readSolanaTokenBalance(OWNER, SOLANA_USDC_ASSET, "https://rpc.example")).resolves.toEqual({
      optedIn: true,
      amount: 1_000_000n,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("treats a missing account as no token account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ result: { value: null } })),
    );

    await expect(readSolanaUsdc(OWNER, "https://rpc.example")).resolves.toEqual({
      optedIn: false,
      amount: 0n,
    });
  });

  it("reports a failed lookup as an unreadable USDC balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { message: "indexed" } })),
    );

    await expect(readSolanaUsdc(OWNER, "https://rpc.example")).rejects.toThrow(
      "Could not read the USDC balance for this wallet.",
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
