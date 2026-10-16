import { useEffect, useState } from "react";
import {
  attestedUsdcSpent,
  experimentApis,
  fetchExperiment,
  formatTime,
  shorten,
  statusCopy,
  statusLabel,
  timeLeft,
  type ExperimentAttestation,
  type ExperimentDocument,
} from "./model";

interface Props {
  apiBase: string;
  fallbackApi?: string;
}

export default function ExperimentsApp({ apiBase, fallbackApi }: Props) {
  const [experiment, setExperiment] = useState<ExperimentDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const bundleApi = experimentApis(apiBase, fallbackApi)[0] ?? apiBase;
  useEffect(() => {
    const apiBases = experimentApis(apiBase, fallbackApi);
    let cancelled = false;
    const load = () => {
      void fetchExperiment(apiBases).then(
        (next) => {
          if (cancelled) return;
          setExperiment(next);
          setError(null);
          setNow(Date.now());
        },
        (reason: unknown) => {
          if (cancelled) return;
          setError(reason instanceof Error ? reason.message : "The experiment status could not be loaded.");
          setNow(Date.now());
        },
      );
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiBase, fallbackApi]);

  if (!experiment && error) {
    return (
      <p className="experiment-error" role="alert">
        {error}
      </p>
    );
  }
  if (!experiment) {
    return <p className="experiment-note">Loading the experiment.</p>;
  }

  return (
    <div>
      {experiment.preview ? (
        <p className="experiment-preview">Sample data for a local preview. This is not a live run.</p>
      ) : null}
      {error ? (
        <p className="experiment-error" role="alert">
          {error}
        </p>
      ) : null}
      <dl className="facts" aria-label="Experiment stats">
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(experiment.status)}</dd>
        </div>
        <div>
          <dt>Blocks attested</dt>
          <dd>{experiment.stats.attested.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Failures</dt>
          <dd>{experiment.stats.failures.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>USDC spent</dt>
          <dd>{attestedUsdcSpent(experiment.stats.attested)}</dd>
        </div>
        <div>
          <dt>Behind tip</dt>
          <dd>{experiment.stats.lag} blocks</dd>
        </div>
      </dl>
      <p className="experiment-status">{statusCopy(experiment)}</p>
      <dl className="experiment-window">
        <div>
          <dt>Window</dt>
          <dd>
            {experiment.window
              ? `${formatTime(experiment.window.start)} – ${formatTime(experiment.window.end)}`
              : "Not opened"}
          </dd>
        </div>
        <div>
          <dt>Time left</dt>
          <dd>{timeLeft(experiment, now)}</dd>
        </div>
        <div>
          <dt>Bitcoin tip</dt>
          <dd>{experiment.stats.tip === null ? "—" : experiment.stats.tip.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Next height</dt>
          <dd>{experiment.stats.nextHeight === null ? "—" : experiment.stats.nextHeight.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>Algorand USDC through x402</dd>
        </div>
      </dl>
      {experiment.stats.lastError ? <p className="experiment-note">Last error: {experiment.stats.lastError}</p> : null}
      <AttestationTable apiBase={bundleApi} rows={experiment.attestations} />
    </div>
  );
}

function AttestationTable({ apiBase, rows }: { apiBase: string; rows: ExperimentAttestation[] }) {
  if (rows.length === 0) {
    return <p className="experiment-note">No blocks attested yet.</p>;
  }
  return (
    <div className="experiment-table-wrap">
      <table className="experiment-table">
        <caption className="visually-hidden">Attested Bitcoin blocks</caption>
        <thead>
          <tr>
            <th scope="col">Height</th>
            <th scope="col">Block</th>
            <th scope="col">Attestation</th>
            <th scope="col">Time</th>
            <th scope="col">Bundle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.height}>
              <td>{row.height.toLocaleString("en-US")}</td>
              <td>{blockLink(row.blockHash)}</td>
              <td>
                <a href={`https://allo.info/tx/${row.attestTxnId}`} target="_blank" rel="noopener noreferrer">
                  {shorten(row.attestTxnId)}
                  <span className="visually-hidden"> (opens Allo in a new tab)</span>
                </a>
              </td>
              <td>{formatTime(row.attestedAt)}</td>
              <td>
                {row.skipped ? "—" : <a href={`${apiBase}/attestations/${row.height}`}>Bundle</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function blockLink(hash: string | null) {
  if (!hash) {
    return "—";
  }
  return (
    <a href={`https://mempool.space/block/${hash}`} target="_blank" rel="noopener noreferrer">
      {shorten(hash)}
      <span className="visually-hidden"> (opens mempool.space in a new tab)</span>
    </a>
  );
}
