import { describe, expect, it } from "vitest";
import { BASE_NETWORK, SOLANA_NETWORK, selectAccept } from "./pay-attest";

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
