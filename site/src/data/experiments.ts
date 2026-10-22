import { links } from "./site";

export interface ExperimentListing {
  id: string;
  title: string;
  summary: string;
  apiBase: string;
  fallbackApi?: string;
}

/** Add a listing here when another experiment Worker is published. */
export const experiments: ExperimentListing[] = [
  {
    id: "bitcoin-blocks-24h",
    title: "Bitcoin blocks, 24 hours",
    summary:
      "For 24 hours, attest each Bitcoin block once it is two behind the chain tip. Each call pays in Algorand USDC.",
    apiBase: links.experiments,
    fallbackApi: links.experimentsFallback,
  },
  {
    id: "ethereum-blocks-6h",
    title: "Ethereum blocks, 6 hours",
    summary:
      "The first 6-hour Ethereum run. Each block was attested once it was two behind the chain tip. Each call paid in Algorand USDC.",
    apiBase: `${links.experiments}/ethereum/archive`,
    fallbackApi: `${links.experimentsFallback}/ethereum/archive`,
  },
  {
    id: "ethereum-blocks-6h-2",
    title: "Ethereum blocks, 6 hours (2)",
    summary:
      "For 6 hours, attest each Ethereum block once it is two behind the chain tip. Each call pays in Algorand USDC.",
    apiBase: `${links.experiments}/ethereum`,
    fallbackApi: `${links.experimentsFallback}/ethereum`,
  },
];

export function experimentById(id: string): ExperimentListing | undefined {
  return experiments.find((experiment) => experiment.id === id);
}
