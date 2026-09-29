import type { PayNetwork } from "../lib/pay-attest";

const PAY_NETWORK_KEY = "pq-attest:pay-network";
const SOLANA_WALLET_KEY = "connector-kit:v1:wallet";
const ALGORAND_STATE_KEY = "@txnlab/use-wallet:v5";
const SOLANA_SESSION_KEYS = [
  SOLANA_WALLET_KEY,
  "connector-kit:v1:account",
  "connector-kit:v1:wallet-state",
  "connector-kit:wallet",
  "connector-kit:account",
] as const;
const BASE_SESSION_KEYS = ["wagmi.recentConnectorId", "wagmi.store"] as const;

const NETWORKS: readonly PayNetwork[] = ["base", "algorand", "solana"];

export function readStoredPayNetwork(): PayNetwork | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const value = localStorage.getItem(PAY_NETWORK_KEY);
    if (value === "base" || value === "algorand" || value === "solana") {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

/** Network to show on load. A saved Solana wallet counts when no network was chosen yet. */
export function initialPayNetwork(): PayNetwork | null {
  const stored = readStoredPayNetwork();
  if (stored) {
    return stored;
  }
  if (savedSolanaWallet() && !savedAlgorandWallet()) {
    return "solana";
  }
  return null;
}

export function shouldRestoreSolana(): boolean {
  return initialPayNetwork() === "solana";
}

export function shouldRestoreBase(): boolean {
  return readStoredPayNetwork() === "base";
}

/** Drop the connector's saved Solana wallet so the next connect can pick another. */
export function forgetSolanaWallet(): void {
  removeKeys(SOLANA_SESSION_KEYS);
}

/** Drop wagmi's saved Base connector so the next connect can pick another. */
export function forgetBaseWallet(): void {
  removeKeys(BASE_SESSION_KEYS);
}

export function storePayNetwork(network: PayNetwork | null): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    if (network === null || !NETWORKS.includes(network)) {
      localStorage.removeItem(PAY_NETWORK_KEY);
      return;
    }
    localStorage.setItem(PAY_NETWORK_KEY, network);
  } catch {
    /* Private browsing can reject storage writes. */
  }
}

function savedSolanaWallet(): boolean {
  const value = readJson(SOLANA_WALLET_KEY);
  return typeof value === "string" && value.length > 0;
}

function savedAlgorandWallet(): boolean {
  const value = readJson(ALGORAND_STATE_KEY);
  if (!value || typeof value !== "object") {
    return false;
  }
  const activeWallet = (value as { activeWallet?: unknown }).activeWallet;
  return typeof activeWallet === "string" && activeWallet.length > 0;
}

function removeKeys(keys: readonly string[]): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    /* Private browsing can reject storage writes. */
  }
}

function readJson(key: string): unknown {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
