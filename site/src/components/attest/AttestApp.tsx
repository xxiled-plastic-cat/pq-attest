import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider, useNetwork, useWallet } from "@txnlab/use-wallet-react";
import { AppProvider, useTransactionSigner, useWallet as useSolanaWallet } from "@solana/connector/react";
import { useConfig, useConnection, useDisconnect, WagmiProvider } from "wagmi";
import { getConnection, getWalletClient, switchChain } from "wagmi/actions";
import { base } from "wagmi/chains";
import type { ClientEvmSigner } from "@x402/evm";
import type { Config } from "wagmi";
import { chainById, chains, resolveTxid } from "../../data/chains";
import { discoveryUrl, links } from "../../data/site";
import {
  InsufficientUsdc,
  OptInRequired,
  fetchListedPrice,
  formatAtomicUsdc,
  optInToUsdc,
  payAndAttest,
  readBaseUsdc,
  readSolanaUsdc,
  readUsdcHolding,
  walletErrorMessage,
  type ListedPrice,
  type PayNetwork,
  type PayPhase,
  type ProofView,
  type UsdcHolding,
} from "../../lib/pay-attest";
import { getWalletManager } from "../../wallet/manager";
import { PaySessionProvider, usePaySession } from "../../wallet/session";
import { forgetBaseWallet, shouldRestoreBase } from "../../wallet/session-storage";
import { createSolanaPaymentSigner } from "../../wallet/solana-payment-signer";
import { releaseSolanaSession } from "../../wallet/solana-release";
import { getSolanaConfig, getSolanaMobileConfig } from "../../wallet/solana";
import { getQueryClient, getWagmiConfig } from "../../wallet/wagmi";
import WalletDialog from "./WalletDialog";

export default function AttestApp() {
  const [manager] = useState(getWalletManager);
  const [wagmiConfig] = useState(getWagmiConfig);
  const [queryClient] = useState(getQueryClient);
  const [solanaConfig] = useState(getSolanaConfig);
  const [solanaMobile] = useState(getSolanaMobileConfig);
  const [reconnectBase] = useState(shouldRestoreBase);
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={reconnectBase}>
      <QueryClientProvider client={queryClient}>
        <AppProvider connectorConfig={solanaConfig} mobile={solanaMobile}>
          <WalletProvider manager={manager}>
            <PaySessionProvider>
              <AttestForm />
            </PaySessionProvider>
          </WalletProvider>
        </AppProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function AttestForm() {
  const { activeAddress, activeWallet, activeWalletAccounts, algodClient, signTransactions } = useWallet();
  const { activeNetworkConfig } = useNetwork();
  const { network, choose, clear } = usePaySession();
  const baseConnection = useConnection();
  const wagmiConfig = useConfig();
  const { mutateAsync: disconnectBase } = useDisconnect();
  const solanaWallet = useSolanaWallet();
  const { signer: connectorSigner } = useTransactionSigner();
  const solanaSigner = useMemo(
    () => (connectorSigner ? createSolanaPaymentSigner(connectorSigner) : null),
    [connectorSigner],
  );
  const [chainId, setChainId] = useState<(typeof chains)[number]["id"]>("algorand");
  const [txid, setTxid] = useState("");
  const [mode, setMode] = useState<"transaction" | "block">("transaction");
  const [height, setHeight] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [price, setPrice] = useState<ListedPrice | null>(null);
  const [holding, setHolding] = useState<UsdcHolding | null>(null);
  const [holdingError, setHoldingError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PayPhase | "opt-in" | "confirming" | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<ProofView | null>(null);
  const [copied, setCopied] = useState(false);
  const ignoreRestore = useRef(false);

  const payNetwork: PayNetwork | null = network ?? (activeAddress ? "algorand" : null);
  const connectedAddress = addressFor(payNetwork, {
    base: baseConnection.address,
    algorand: activeAddress,
    solana: solanaWallet.account,
  });
  const chain = chainById(chainId) ?? chains[0];
  const busy = phase !== "idle";
  const accounts = activeWalletAccounts ?? [];
  const shortfall = holding?.optedIn && price ? holding.amount < BigInt(price.atomic) : false;
  const needsOptIn = payNetwork === "algorand" && holding ? !holding.optedIn : false;
  const missingSolanaAccount = payNetwork === "solana" && holding ? !holding.optedIn : false;

  useEffect(() => {
    if (network !== null || ignoreRestore.current) {
      return;
    }
    if (activeAddress) {
      choose("algorand");
      return;
    }
    if (solanaWallet.account) {
      choose("solana");
      return;
    }
    if (baseConnection.address) {
      choose("base");
    }
  }, [network, activeAddress, solanaWallet.account, baseConnection.address, choose]);

  useEffect(() => {
    let cancelled = false;
    fetchListedPrice(discoveryUrl, payNetwork ?? undefined)
      .then((listed) => {
        if (!cancelled) {
          setPrice(listed);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [payNetwork]);

  useEffect(() => {
    if (!connectedAddress || !payNetwork) {
      setHolding(null);
      setHoldingError(null);
      return;
    }
    let cancelled = false;
    setHolding(null);
    setHoldingError(null);
    const read =
      payNetwork === "base"
        ? readBaseUsdc(connectedAddress as `0x${string}`)
        : payNetwork === "solana"
          ? readSolanaUsdc(connectedAddress)
          : readUsdcHolding(algodClient, connectedAddress);
    read
      .then((next) => {
        if (!cancelled) {
          setHolding(next);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setHoldingError(caught instanceof Error ? caught.message : "Could not read the USDC balance.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectedAddress, payNetwork, algodClient]);

  const priceLabel = price ? `${price.priceUsdc} USDC` : "USDC";
  const status = statusText(phase, priceLabel);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setProof(null);
    setCopied(false);
    const blockNumber = height.trim();
    if (mode === "block" && !/^[0-9]+$/.test(blockNumber)) {
      setError("Enter a block number.");
      return;
    }
    const resolved = mode === "block" ? { txid: blockNumber } : resolveTxid(chainId, txid);
    if ("error" in resolved) {
      setError(resolved.error);
      return;
    }
    if (!payNetwork || !connectedAddress) {
      setWalletOpen(true);
      return;
    }
    if (holding && payNetwork === "algorand" && !holding.optedIn) {
      setError("Opt in to USDC before paying.");
      return;
    }
    if (holding && payNetwork === "solana" && !holding.optedIn) {
      setError("This wallet has no USDC account.");
      return;
    }
    if (shortfall && price && holding) {
      setError(
        `This wallet holds ${formatAtomicUsdc(holding.amount)} USDC. An attestation costs ${price.priceUsdc} USDC.`,
      );
      return;
    }

    setPhase("terms");
    try {
      const blockRequest =
        mode === "block"
          ? { path: "/attest-block" as const, body: { chain: chainId, height: blockNumber } }
          : null;
      const next = await payAndAttest(
        payNetwork === "algorand"
          ? {
              apiBase: links.apiBase,
              chain: chainId,
              txid: mode === "block" ? blockNumber : resolved.txid,
              address: connectedAddress,
              network: "algorand",
              algod: algodClient,
              algodUrl: activeNetworkConfig.algod.baseServer,
              signTransactions,
              onPhase: setPhase,
              ...(blockRequest ?? {}),
            }
          : payNetwork === "base"
            ? {
                apiBase: links.apiBase,
                chain: chainId,
                txid: mode === "block" ? blockNumber : resolved.txid,
                address: connectedAddress,
                network: "base",
                signer: basePaymentSigner(wagmiConfig, connectedAddress as `0x${string}`),
                onPhase: setPhase,
                ...(blockRequest ?? {}),
              }
            : {
                apiBase: links.apiBase,
                chain: chainId,
                txid: mode === "block" ? blockNumber : resolved.txid,
                address: connectedAddress,
                network: "solana",
                signer: solanaSigner ?? missingSolanaSigner(),
                onPhase: setPhase,
                ...(blockRequest ?? {}),
              },
      );
      setProof(next);
      setPhase("idle");
      const refreshed =
        payNetwork === "base"
          ? await readBaseUsdc(connectedAddress as `0x${string}`)
          : payNetwork === "solana"
            ? await readSolanaUsdc(connectedAddress)
            : await readUsdcHolding(algodClient, connectedAddress);
      setHolding(refreshed);
    } catch (caught) {
      setPhase("idle");
      if (caught instanceof OptInRequired) {
        setHolding({ optedIn: false, amount: 0n });
        setError("Opt in to USDC before paying.");
        return;
      }
      if (caught instanceof InsufficientUsdc) {
        setError(caught.message);
        return;
      }
      setError(walletErrorMessage(caught));
    }
  }

  async function onOptIn() {
    if (!activeAddress) {
      setWalletOpen(true);
      return;
    }
    setError(null);
    setPhase("opt-in");
    try {
      await optInToUsdc({
        algod: algodClient,
        address: activeAddress,
        signTransactions,
        onConfirming: () => setPhase("confirming"),
      });
      const next = await readUsdcHolding(algodClient, activeAddress);
      setHolding(next);
      setPhase("idle");
    } catch (caught) {
      setPhase("idle");
      setError(walletErrorMessage(caught));
    }
  }

  async function onDisconnect() {
    ignoreRestore.current = true;
    if (payNetwork === "base") {
      await disconnectBase();
      forgetBaseWallet();
    } else if (payNetwork === "solana") {
      await releaseSolanaSession();
    } else {
      await activeWallet?.disconnect();
    }
    clear();
  }

  async function copyProof() {
    if (!proof) {
      return;
    }
    await navigator.clipboard.writeText(proof.json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <form className="attest-card" onSubmit={(event) => void onSubmit(event)}>
        <div className="attest-fields">
          <div className="attest-field">
            <span>What to attest</span>
            <div className="attest-modes">
              {(
                [
                  ["transaction", "Transaction"],
                  ["block", "Block"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={mode === value ? "attest-mode is-active" : "attest-mode"}
                  disabled={busy}
                  onClick={() => {
                    setMode(value);
                    setError(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="attest-field">
            <span>Chain</span>
            <select
              name="chain"
              value={chainId}
              disabled={busy}
              onChange={(event) => {
                const next = chainById(event.target.value);
                if (next) {
                  setChainId(next.id);
                  setError(null);
                }
              }}
            >
              {chains.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {mode === "transaction" ? (
          <label className="attest-field">
            <span>Transaction id</span>
            <input
              name="txid"
              value={txid}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={chain.placeholder}
              onChange={(event) => {
                setTxid(event.target.value);
                setError(null);
              }}
            />
            <p className="attest-hint">{chain.hint}</p>
          </label>
          ) : null}

          {mode === "block" ? (
            <label className="attest-field">
              <span>Block number</span>
              <input
                name="height"
                value={height}
                disabled={busy}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="21000000"
                onChange={(event) => {
                  setHeight(event.target.value);
                  setError(null);
                }}
              />
            </label>
          ) : null}

        </div>

        <div className="attest-terms">
          <div className="attest-pay">
            <p>
              <span>Payment</span>
              {price ? (
                <strong>{price.priceUsdc} USDC</strong>
              ) : (
                <span className="sk sk-text" style={{ width: "9ch" }} aria-label="Loading the price" />
              )}
            </p>
          </div>

          <div className="attest-wallet">
            {connectedAddress && payNetwork ? (
              <>
                <p className="attest-wallet-account">
                  <span>{networkName(payNetwork)}</span>
                  <code title={connectedAddress}>{shortAddress(connectedAddress)}</code>
                  <button type="button" className="attest-text-button" disabled={busy} onClick={() => void onDisconnect()}>
                    Disconnect
                  </button>
                </p>
                {payNetwork === "algorand" && accounts.length > 1 && activeWallet ? (
                  <label className="attest-field">
                    <span>Account</span>
                    <select
                      value={activeAddress ?? connectedAddress}
                      disabled={busy}
                      onChange={(event) => activeWallet.setActiveAccount(event.target.value)}
                    >
                      {accounts.map((account) => (
                        <option key={account.address} value={account.address}>
                          {shortAddress(account.address)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            ) : (
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => setWalletOpen(true)}>
                Connect wallet
              </button>
            )}
          </div>
        </div>

        {payNetwork === "algorand" && connectedAddress && holding && !holding.optedIn ? (
          <div className="attest-note">
            <p>This wallet is not opted in to USDC. Opt in to pay. You pay the opt-in fee in ALGO.</p>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void onOptIn()}>
              {phase === "opt-in" || phase === "confirming" ? "Opting in…" : "Opt in to USDC"}
            </button>
          </div>
        ) : null}

        {missingSolanaAccount ? (
          <p className="attest-error" role="alert">
            This wallet has no USDC account.
          </p>
        ) : null}

        {connectedAddress && shortfall && holding && price ? (
          <p className="attest-error" role="alert">
            This wallet holds {formatAtomicUsdc(holding.amount)} USDC. An attestation costs {price.priceUsdc} USDC.
          </p>
        ) : null}

        {holdingError ? (
          <p className="attest-error" role="alert">
            {holdingError}
          </p>
        ) : null}

        <div className="attest-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || shortfall || needsOptIn || missingSolanaAccount}
          >
            Attest
          </button>
          <p className="attest-status" role="status">
            {status}
          </p>
        </div>

        {error ? (
          <p className="attest-error" role="alert">
            {error}
          </p>
        ) : null}

        {proof ? (
          <section className="attest-result" aria-label="Proof bundle">
            <dl>
              <div>
                <dt>Source</dt>
                <dd>{proof.sourceId}</dd>
              </div>
              <div>
                <dt>Fingerprint</dt>
                <dd>{proof.hashSha256}</dd>
              </div>
              <div>
                <dt>Attestation</dt>
                <dd>
                  <a
                    className="outbound"
                    href={`https://allo.info/tx/${proof.attestId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {proof.attestId}
                    <span className="visually-hidden"> (opens Allo in a new tab)</span>
                  </a>
                </dd>
              </div>
              {proof.round !== null ? (
                <div>
                  <dt>Round</dt>
                  <dd>{proof.round.toLocaleString("en-US")}</dd>
                </div>
              ) : null}
              <div>
                <dt>Signed with</dt>
                <dd>{proof.algorithm}</dd>
              </div>
            </dl>
            <div className="attest-json">
              <div className="attest-json-bar">
                <span>Bundle</span>
                <button type="button" onClick={() => void copyProof()}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre>
                <code>{proof.json}</code>
              </pre>
            </div>
          </section>
        ) : null}
      </form>

      <WalletDialog
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        onError={(message) => {
          setWalletOpen(false);
          setError(message);
        }}
      />
    </>
  );
}

function addressFor(
  network: PayNetwork | null,
  addresses: { base?: string; algorand?: string | null; solana?: string | null },
): string | null {
  if (network === "base") {
    return addresses.base ?? null;
  }
  if (network === "solana") {
    return addresses.solana ?? null;
  }
  if (network === "algorand") {
    return addresses.algorand ?? null;
  }
  return null;
}

function networkName(network: PayNetwork): string {
  if (network === "base") {
    return "Base";
  }
  if (network === "solana") {
    return "Solana";
  }
  return "Algorand";
}

function basePaymentSigner(config: Config, address: `0x${string}`): ClientEvmSigner {
  return {
    address,
    async signTypedData(message) {
      const connection = getConnection(config);
      if (connection.chainId !== base.id) {
        await switchChain(config, { chainId: base.id });
      }
      const client = await getWalletClient(config, { chainId: base.id });
      if (!client) {
        throw new Error("Connect a Base wallet.");
      }
      try {
        return await client.signTypedData({
          account: client.account,
          domain: message.domain,
          types: message.types,
          primaryType: message.primaryType,
          message: message.message,
        } as Parameters<typeof client.signTypedData>[0]);
      } catch (error) {
        throw new Error(walletErrorMessage(error));
      }
    },
  };
}

function missingSolanaSigner(): never {
  throw new Error("Connect a Solana wallet.");
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function statusText(phase: PayPhase | "opt-in" | "confirming" | "idle", priceLabel: string): string | null {
  switch (phase) {
    case "terms":
      return "Requesting payment terms.";
    case "signing":
      return `Sign ${priceLabel} in your wallet.`;
    case "recording":
      return "Recording the attestation.";
    case "opt-in":
      return "Sign the USDC opt-in in your wallet.";
    case "confirming":
      return "Waiting for the opt-in to confirm.";
    default:
      return null;
  }
}
