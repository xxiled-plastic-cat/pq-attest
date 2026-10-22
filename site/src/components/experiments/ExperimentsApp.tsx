import { useEffect, useRef, useState } from "react";
import {
  attestationPage,
  attestedUsdcSpent,
  blockExplorerName,
  blockExplorerUrl,
  chainLabel,
  experimentApis,
  fetchExperiment,
  formatLatency,
  formatTime,
  paidProgress,
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
          <dt>{experiment.mode === "test" ? "Test" : "Window"}</dt>
          <dd>
            {experiment.mode === "test"
              ? paidProgress(experiment)
              : experiment.window
                ? `${formatTime(experiment.window.start)} – ${formatTime(experiment.window.end)}`
                : "Not opened"}
          </dd>
        </div>
        <div>
          <dt>Time left</dt>
          <dd>{timeLeft(experiment, now)}</dd>
        </div>
        <div>
          <dt>{chainLabel(experiment.chain)} tip</dt>
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
      <AttestationTable apiBase={bundleApi} chain={experiment.chain} rows={experiment.attestations} />
    </div>
  );
}

function AttestationTable({
  apiBase,
  chain,
  rows,
}: {
  apiBase: string;
  chain: ExperimentDocument["chain"];
  rows: ExperimentAttestation[];
}) {
  const [page, setPage] = useState(1);
  const topRef = useRef<HTMLDivElement>(null);
  const view = attestationPage(rows, page);
  if (rows.length === 0) {
    return <p className="experiment-note">No blocks attested yet.</p>;
  }
  const showPager = view.pageCount > 1;
  const turn = (next: number) => {
    setPage(next);
    topRef.current?.scrollIntoView({ block: "start" });
  };
  return (
    <div ref={topRef}>
      <div className="experiment-table-wrap">
        <table className="experiment-table">
          <caption className="visually-hidden">Attested blocks, latest first</caption>
          <thead>
            <tr>
              <th scope="col">Height</th>
              <th scope="col">Block</th>
              <th scope="col">Attestation</th>
              <th scope="col">Time</th>
              <th scope="col">Latency</th>
              <th scope="col">Bundle</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.height}>
                <td>{row.height.toLocaleString("en-US")}</td>
                <td>{blockLink(row.blockHash, chain)}</td>
                <td>
                  <a href={`https://allo.info/tx/${row.attestTxnId}`} target="_blank" rel="noopener noreferrer">
                    {shorten(row.attestTxnId)}
                    <span className="visually-hidden"> (opens Allo in a new tab)</span>
                  </a>
                </td>
                <td>{formatTime(row.attestedAt)}</td>
                <td>{formatLatency(row.elapsedMs)}</td>
                <td>
                  {row.skipped ? "—" : <a href={`${apiBase}/attestations/${row.height}`}>Bundle</a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPager ? <AttestationPager view={view} onPage={turn} /> : null}
    </div>
  );
}

function AttestationPager({
  view,
  onPage,
}: {
  view: ReturnType<typeof attestationPage>;
  onPage: (page: number) => void;
}) {
  return (
    <nav className="experiment-pager" aria-label="Attestation pages">
      <button type="button" className="button button-secondary" disabled={view.page <= 1} onClick={() => onPage(view.page - 1)}>
        Previous
      </button>
      <p>
        Page {view.page.toLocaleString("en-US")} of {view.pageCount.toLocaleString("en-US")}
      </p>
      <button
        type="button"
        className="button button-secondary"
        disabled={view.page >= view.pageCount}
        onClick={() => onPage(view.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

function blockLink(hash: string | null, chain: ExperimentDocument["chain"]) {
  if (!hash) {
    return "—";
  }
  const explorer = blockExplorerName(chain);
  return (
    <a href={blockExplorerUrl(chain, hash)} target="_blank" rel="noopener noreferrer">
      {shorten(hash)}
      <span className="visually-hidden"> (opens {explorer} in a new tab)</span>
    </a>
  );
}
