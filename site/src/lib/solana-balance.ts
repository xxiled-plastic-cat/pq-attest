import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/addresses";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Browser-reachable mainnet RPC. api.mainnet-beta.solana.com rejects requests that carry an Origin. */
export const SOLANA_RPC_URL = "https://solana-rpc.publicnode.com";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const encoder = getAddressEncoder();

/**
 * Associated token account for an owner and mint.
 * Public RPCs reject getTokenAccountsByOwner from browsers, so balances are read from this account.
 */
export async function associatedTokenAddress(owner: string, mint: string): Promise<string> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [encoder.encode(address(owner)), encoder.encode(address(TOKEN_PROGRAM)), encoder.encode(address(mint))],
  });
  return ata;
}

export interface SolanaTokenHolding {
  optedIn: boolean;
  amount: bigint;
}

export async function readSolanaTokenBalance(
  owner: string,
  mint: string,
  rpcUrl = SOLANA_RPC_URL,
): Promise<SolanaTokenHolding> {
  const account = await associatedTokenAddress(owner, mint);
  const value = await accountInfo(rpcUrl, account);
  if (!value) {
    return { optedIn: false, amount: 0n };
  }
  const raw = tokenAmount(value);
  if (raw === null) {
    throw new Error("Could not read the token balance for this wallet.");
  }
  return { optedIn: true, amount: raw };
}

export async function readSolanaUsdc(owner: string, rpcUrl = SOLANA_RPC_URL): Promise<SolanaTokenHolding> {
  try {
    return await readSolanaTokenBalance(owner, USDC_MINT, rpcUrl);
  } catch {
    throw new Error("Could not read the USDC balance for this wallet.");
  }
}

async function accountInfo(rpcUrl: string, account: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [account, { encoding: "jsonParsed" }],
      }),
    });
  } catch {
    throw new Error("Could not read the token balance for this wallet.");
  }
  if (!response.ok) {
    throw new Error("Could not read the token balance for this wallet.");
  }
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: { value?: unknown };
  };
  if (body.error) {
    throw new Error("Could not read the token balance for this wallet.");
  }
  return body.result?.value ?? null;
}

function tokenAmount(value: unknown): bigint | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") {
    return null;
  }
  const info = (data as { parsed?: { info?: { tokenAmount?: { amount?: unknown } } } }).parsed?.info;
  const raw = info?.tokenAmount?.amount;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return null;
  }
  return BigInt(raw);
}
