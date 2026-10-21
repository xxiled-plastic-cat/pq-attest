import { AlgorandClient, ClientManager } from "@algorandfoundation/algokit-utils";

export interface ChainClients {
  algod: ReturnType<typeof ClientManager.getAlgodClient>;
  indexer: ReturnType<typeof ClientManager.getIndexerClient>;
  algorand: AlgorandClient;
}

/**
 * Build the algod and indexer clients with the API token, then wrap those same
 * objects so payment groups are suggested and signed through them.
 */
export function createChainClients(options: {
  algodUrl: string;
  indexerUrl: string;
  algodToken?: string | undefined;
  indexerToken?: string | undefined;
}): ChainClients {
  const algod = ClientManager.getAlgodClient(clientConfig(options.algodUrl, options.algodToken));
  const indexer = ClientManager.getIndexerClient(clientConfig(options.indexerUrl, options.indexerToken));
  return {
    algod,
    indexer,
    algorand: AlgorandClient.fromClients({ algod, indexer }),
  };
}

function clientConfig(url: string, token: string | undefined) {
  const endpoint = splitEndpoint(url);
  const trimmed = token?.trim() ?? "";
  if (!trimmed) {
    return { server: endpoint.server, port: endpoint.port };
  }
  return { server: endpoint.server, port: endpoint.port, token: trimmed };
}

function splitEndpoint(value: string): { server: string; port: string } {
  const raw = value.trim();
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  const server = `${url.protocol}//${url.hostname}${url.pathname}`.replace(/\/+$/, "");
  const port = url.port || (url.protocol === "http:" ? "80" : "443");
  return { server, port };
}
