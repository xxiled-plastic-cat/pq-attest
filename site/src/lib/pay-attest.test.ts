import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_NETWORK, SOLANA_NETWORK, fetchListedPrice, selectAccept, solanaSelfPaymentMessage } from "./pay-attest";

const algorand = accept("algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=");
const base = accept(BASE_NETWORK);
const solana = accept(SOLANA_NETWORK);
const baseSepolia = accept("eip155:84532");

describe("selectAccept", () => {
  const accepts = [algorand, base, solana];

  it("picks the connected rail", () => {
    expect(selectAccept(accepts, "base").network).toBe(BASE_NETWORK);
    expect(selectAccept(accepts, "solana").network).toBe(SOLANA_NETWORK);
    expect(selectAccept(accepts, "algorand").network).toMatch(/^algorand:/);
  });

  it("rejects a rail the payment terms do not advertise", () => {
    expect(() => selectAccept([algorand], "base")).toThrow(/Base USDC/);
    expect(() => selectAccept([base], "solana")).toThrow(/Solana USDC/);
    expect(() => selectAccept([solana], "algorand")).toThrow(/Algorand USDC/);
    expect(() => selectAccept([baseSepolia], "base")).toThrow(/Base USDC/);
  });
});

describe("solanaSelfPaymentMessage", () => {
  const payTo = "4QbPizw4V3eM1TVtXWh4yBSowqBVPq4pqYx3GrHwoCsL";

  it("blocks a payment from the receiving wallet", () => {
    expect(solanaSelfPaymentMessage(payTo, payTo)).toMatch(/another Solana wallet/);
  });

  it("allows a payment from any other wallet", () => {
    expect(solanaSelfPaymentMessage("2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4", payTo)).toBeNull();
  });
});

describe("fetchListedPrice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the connected rail amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          accepts: [
            { network: "algorand-mainnet", priceUsdc: "0.001", maxAmountRequired: "1000" },
            { network: SOLANA_NETWORK, priceUsdc: "0.01", maxAmountRequired: "10000" },
            { network: BASE_NETWORK, priceUsdc: "0.002", maxAmountRequired: "2000" },
          ],
        }),
      ),
    );
    await expect(fetchListedPrice("https://example.test/discovery", "solana")).resolves.toEqual({
      priceUsdc: "0.01",
      atomic: "10000",
    });
    await expect(fetchListedPrice("https://example.test/discovery", "algorand")).resolves.toEqual({
      priceUsdc: "0.001",
      atomic: "1000",
    });
    await expect(fetchListedPrice("https://example.test/discovery")).resolves.toEqual({
      priceUsdc: "0.001",
      atomic: "1000",
    });
  });
});

function accept(network: string) {
  return {
    scheme: "exact",
    network,
    amount: "1000",
    asset: "asset",
    payTo: "payTo",
    maxTimeoutSeconds: 60,
  };
}
