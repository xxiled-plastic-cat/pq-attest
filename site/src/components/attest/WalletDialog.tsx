import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Connector } from "wagmi";
import { useConnect, useConnectors, useDisconnect } from "wagmi";
import { base } from "wagmi/chains";
import type { Wallet } from "@txnlab/use-wallet-react";
import { useWallet } from "@txnlab/use-wallet-react";
import {
  useConnectWallet,
  useDisconnectWallet,
  useWalletConnectors,
  type WalletConnectorMetadata,
} from "@solana/connector/react";
import type { PayNetwork } from "../../lib/pay-attest";
import { walletErrorMessage } from "../../lib/pay-attest";
import { visibleBaseConnectors } from "../../wallet/base-connectors";
import { usePaySession } from "../../wallet/session";

const ALGO_ORDER = ["lute", "pera"] as const;

const NETWORKS: { id: PayNetwork; label: string; detail: string }[] = [
  { id: "base", label: "Base", detail: "USDC on Base." },
  { id: "algorand", label: "Algorand", detail: "USDC on Algorand MainNet." },
  { id: "solana", label: "Solana", detail: "USDC on Solana." },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onError: (message: string) => void;
}

export default function WalletDialog({ open, onClose, onError }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<"network" | PayNetwork>("network");

  const { choose } = usePaySession();
  const { wallets, activeWallet } = useWallet();
  const baseConnectors = visibleBaseConnectors(useConnectors());
  const { mutateAsync: connectBase } = useConnect();
  const { mutateAsync: disconnectBase } = useDisconnect();
  const solanaConnectors = useWalletConnectors();
  const { connect: connectSolana } = useConnectWallet();
  const { disconnect: disconnectSolana } = useDisconnectWallet();

  const algoChoices = ALGO_ORDER.map((id) => wallets.find((wallet) => wallet.id === id)).filter(
    (wallet): wallet is Wallet => Boolean(wallet),
  );
  const readySolana = solanaConnectors.filter((connector) => connector.ready);
  const browserSolana = readySolana.filter((connector) => !isMobileConnector(connector));

  useEffect(() => {
    if (!open) {
      setStep("network");
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose, step]);

  if (!open) {
    return null;
  }

  const title = step === "network" ? "Choose a network" : "Choose a wallet";
  const detail =
    step === "network"
      ? "Pay the attestation in USDC on one of these networks."
      : step === "base"
        ? "Installed wallets, or Coinbase Wallet."
        : step === "algorand"
          ? "Lute or Pera, on Algorand MainNet."
          : "Installed Solana wallets.";

  async function chooseBase(connector: Connector) {
    onClose();
    try {
      await connectBase({ connector, chainId: base.id });
      choose("base");
      await settle(disconnectSolana());
      await settle(activeWallet?.disconnect());
    } catch (caught) {
      onError(walletErrorMessage(caught));
    }
  }

  async function chooseAlgorand(wallet: Wallet) {
    onClose();
    try {
      await wallet.connect();
      choose("algorand");
      await settle(disconnectBase());
      await settle(disconnectSolana());
    } catch (caught) {
      onError(walletErrorMessage(caught));
    }
  }

  async function chooseSolana(connector: WalletConnectorMetadata) {
    onClose();
    try {
      await connectSolana(connector.id);
      choose("solana");
      await settle(disconnectBase());
      await settle(activeWallet?.disconnect());
    } catch (caught) {
      onError(walletErrorMessage(caught));
    }
  }

  return createPortal(
    <div
      className="wallet-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className="wallet-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="wallet-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="wallet-dialog-close" onClick={onClose}>
            Close
          </button>
        </div>
        {step === "network" ? null : (
          <button
            type="button"
            className="wallet-dialog-back"
            onClick={() => setStep("network")}
          >
            Back
          </button>
        )}
        <p>{detail}</p>
        {step === "network" ? (
          <ul className="wallet-choices">
            {NETWORKS.map((network) => (
              <li key={network.id}>
                <button type="button" className="wallet-choice" onClick={() => setStep(network.id)}>
                  <span className="wallet-choice-copy">
                    <span>{network.label}</span>
                    <span className="attest-hint">{network.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {step === "base" ? (
          <ul className="wallet-choices">
            {baseConnectors.map((connector) => (
              <li key={connector.uid}>
                <button
                  type="button"
                  className="wallet-choice"
                  onClick={() => {
                    void chooseBase(connector);
                  }}
                >
                  <WalletMark icon={connector.icon} name={connector.name} />
                  <span>{connector.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {step === "algorand" ? (
          <ul className="wallet-choices">
            {algoChoices.map((wallet) => (
              <li key={wallet.id}>
                <button
                  type="button"
                  className="wallet-choice"
                  onClick={() => {
                    void chooseAlgorand(wallet);
                  }}
                >
                  <img src={wallet.metadata.icon} alt="" width="28" height="28" />
                  <span>{wallet.metadata.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {step === "solana" ? (
          <>
            {readySolana.length > 0 ? (
              <ul className="wallet-choices">
                {readySolana.map((connector) => (
                  <li key={connector.id}>
                    <button
                      type="button"
                      className="wallet-choice"
                      onClick={() => {
                        void chooseSolana(connector);
                      }}
                    >
                      <WalletMark icon={connector.icon} name={connector.name} />
                      <span>{connector.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wallet-empty">
                No Solana wallet is installed. Install{" "}
                <a href="https://phantom.com/" target="_blank" rel="noopener noreferrer">
                  Phantom
                </a>{" "}
                or{" "}
                <a href="https://solflare.com/" target="_blank" rel="noopener noreferrer">
                  Solflare
                </a>
                .
              </p>
            )}
            {browserSolana.length === 0 && readySolana.length > 0 ? (
              <p className="wallet-empty">
                No browser wallet is installed. Install{" "}
                <a href="https://phantom.com/" target="_blank" rel="noopener noreferrer">
                  Phantom
                </a>{" "}
                or{" "}
                <a href="https://solflare.com/" target="_blank" rel="noopener noreferrer">
                  Solflare
                </a>
                .
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function WalletMark({ icon, name }: { icon?: string; name: string }) {
  if (icon) {
    return <img src={icon} alt="" width="28" height="28" />;
  }
  return (
    <span className="wallet-choice-mark" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function isMobileConnector(connector: WalletConnectorMetadata): boolean {
  return /mobile|wallet connect/i.test(connector.name);
}

async function settle(task: Promise<unknown> | undefined) {
  if (!task) {
    return;
  }
  try {
    await task;
  } catch {
    /* A previous session can fail to disconnect without blocking the new one. */
  }
}
