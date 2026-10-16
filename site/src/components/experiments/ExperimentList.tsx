import { useEffect, useState } from "react";
import type { ExperimentListing } from "../../data/experiments";
import { experimentApis, fetchExperiment, statusLabel, timeLeft, type ExperimentDocument } from "./model";

interface Props {
  experiments: ExperimentListing[];
}

export default function ExperimentList({ experiments }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [loaded, setLoaded] = useState<Record<string, ExperimentDocument | "error">>({});

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setNow(Date.now());
      for (const experiment of experiments) {
        const apiBases = experimentApis(experiment.apiBase, experiment.fallbackApi);
        void fetchExperiment(apiBases).then(
          (document) => {
            if (cancelled) return;
            setLoaded((current) => ({ ...current, [experiment.id]: document }));
          },
          () => {
            if (cancelled) return;
            setLoaded((current) => ({ ...current, [experiment.id]: "error" }));
          },
        );
      }
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [experiments]);

  return (
    <ul className="experiment-list">
      {experiments.map((experiment) => (
        <li key={experiment.id}>
          <ExperimentCard experiment={experiment} document={loaded[experiment.id]} now={now} />
        </li>
      ))}
    </ul>
  );
}

function ExperimentCard({
  experiment,
  document,
  now,
}: {
  experiment: ExperimentListing;
  document: ExperimentDocument | "error" | undefined;
  now: number;
}) {
  const live = document && document !== "error" ? document : null;
  return (
    <a className="experiment-card" href={`/experiments/${experiment.id}`}>
      <span className="experiment-card-top">
        <span className="section-label">{live ? statusLabel(live.status) : document === "error" ? "Unavailable" : "Loading"}</span>
        <span className="experiment-card-go">
          View
          <span aria-hidden="true"> →</span>
        </span>
      </span>
      <h2>{experiment.title}</h2>
      <p>{experiment.summary}</p>
      <dl className="experiment-card-stats">
        <div>
          <dt>Attested</dt>
          <dd>{live ? live.stats.attested.toLocaleString("en-US") : "—"}</dd>
        </div>
        <div>
          <dt>Failures</dt>
          <dd>{live ? live.stats.failures.toLocaleString("en-US") : "—"}</dd>
        </div>
        <div>
          <dt>USDC spent</dt>
          <dd>{live ? live.stats.usdcSpent : "—"}</dd>
        </div>
        <div>
          <dt>Time left</dt>
          <dd>{live ? timeLeft(live, now) : "—"}</dd>
        </div>
      </dl>
    </a>
  );
}
