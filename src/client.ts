import { AlgorandClient, getAlgoNodeConfig } from '@algorandfoundation/algokit-utils';
import type algosdk from 'algosdk';
import type { IndexerTransaction } from './types.ts';

export const NETWORK = 'algorand-mainnet' as const;
const MAINNET_GENESIS_ID = 'mainnet-v1.0';

type EndpointKind = 'algod' | 'indexer';

function endpointFromEnv(kind: EndpointKind) {
  const prefix = kind === 'algod' ? 'ALGOD' : 'INDEXER';
  const url = process.env[`${prefix}_URL`];
  const server = process.env[`${prefix}_SERVER`];
  const port = process.env[`${prefix}_PORT`] || undefined;
  const token = process.env[`${prefix}_TOKEN`] || undefined;

  if (url) {
    return { server: url, port, token };
  }
  if (server) {
    return { server, port, token };
  }

  return {
    ...getAlgoNodeConfig('mainnet', kind),
    token,
  };
}

export function createAlgorandClient(): AlgorandClient {
  return AlgorandClient.fromConfig({
    algodConfig: endpointFromEnv('algod'),
    indexerConfig: endpointFromEnv('indexer'),
  });
}

export async function assertMainNet(algorand: AlgorandClient) {
  const network = await algorand.client.network();
  if (!network.isMainNet || network.genesisId !== MAINNET_GENESIS_ID) {
    throw new Error(
      `This CLI only attests Algorand MainNet transactions. Connected genesis id is ${network.genesisId}.`,
    );
  }
  return network;
}

export async function fetchIndexerTransaction(
  indexer: algosdk.Indexer,
  txid: string,
): Promise<IndexerTransaction> {
  let raw: Uint8Array;
  try {
    raw = await indexer.lookupTransactionByID(txid).doRaw();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch transaction ${txid} from indexer: ${message}`);
  }

  const body: unknown = JSON.parse(new TextDecoder().decode(raw));
  if (!body || typeof body !== 'object' || !('transaction' in body)) {
    throw new Error(`Indexer did not return transaction ${txid}.`);
  }
  const transaction = (body as { transaction?: unknown }).transaction;
  if (!isIndexerTransaction(transaction)) {
    throw new Error(`Indexer did not return transaction ${txid}.`);
  }
  if (transaction.id !== txid) {
    throw new Error(`Indexer returned ${transaction.id} for requested txid ${txid}.`);
  }
  if (transaction['genesis-id'] !== MAINNET_GENESIS_ID) {
    throw new Error(
      `Transaction ${txid} is on ${String(transaction['genesis-id'])}, not MainNet.`,
    );
  }
  return transaction;
}

function isIndexerTransaction(value: unknown): value is IndexerTransaction {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string';
}

export async function fetchIndexerTransactionWithRetry(
  indexer: algosdk.Indexer,
  txid: string,
  attempts: number,
): Promise<IndexerTransaction> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchIndexerTransaction(indexer, txid);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, 2000);
        });
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch transaction ${txid}.`);
}
