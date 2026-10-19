export const DEFAULT_ETH_RPC_URL = "https://ethereum.publicnode.com";

export function parseEthereumTip(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Ethereum tip was not a height.");
  }
  const result = (body as { result?: unknown }).result;
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new Error("Ethereum tip was not a height.");
  }
  const tip = Number(BigInt(result));
  if (!Number.isSafeInteger(tip)) {
    throw new Error("Ethereum tip was not a height.");
  }
  return tip;
}

export async function fetchEthereumTip(rpcUrl: string, fetchImpl: typeof fetch): Promise<number> {
  const url = rpcUrl.trim();
  if (!url) {
    throw new Error("ETH_RPC_URL is required.");
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error.";
    throw new Error(`Ethereum tip request failed: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`Ethereum tip request failed (${response.status}).`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Ethereum tip was not a height.");
  }
  return parseEthereumTip(body);
}
