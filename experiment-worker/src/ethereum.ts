export const DEFAULT_ETH_RPC_URL = "https://ethereum.publicnode.com";

const PUBLIC_ETH_RPC = [
  DEFAULT_ETH_RPC_URL,
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
  "https://1rpc.io/eth",
  "https://eth.drpc.org",
];

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
  const urls = tipUrls(rpcUrl);
  let last: Error | undefined;
  for (const url of urls) {
    try {
      return await fetchTipOnce(url, fetchImpl);
    } catch (error) {
      last = error instanceof Error ? error : new Error("Ethereum tip request failed.");
      if (!isTipTransportError(last)) {
        throw last;
      }
    }
  }
  throw last ?? new Error("Ethereum tip request failed.");
}

function tipUrls(rpcUrl: string): string[] {
  const normalize = (value: string) => value.trim().replace(/\/$/, "");
  const first = normalize(rpcUrl);
  if (!first) {
    throw new Error("ETH_RPC_URL is required.");
  }
  const known = new Set(PUBLIC_ETH_RPC.map(normalize));
  if (!known.has(first)) {
    return [first];
  }
  return [first, ...PUBLIC_ETH_RPC.map(normalize).filter((item) => item !== first)];
}

function isTipTransportError(error: Error): boolean {
  return /\(\d{3}\)\.?$/.test(error.message) || error.message.includes("Network error");
}

async function fetchTipOnce(url: string, fetchImpl: typeof fetch): Promise<number> {
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
