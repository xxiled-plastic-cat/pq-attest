import { base64ToBytes, bytesToHex } from "../bytes.ts";
import { sha256Bytes } from "../hash.ts";
import { asRecord, envUrl, getJson, type FetchLike } from "../http.ts";
import type { FetchedBlock } from "../types.ts";

const DEFAULT_API = "https://horizon.stellar.org";

export async function fetchStellarBlock(height: string, fetchImpl: FetchLike, env: NodeJS.ProcessEnv): Promise<FetchedBlock> {
  const root = envUrl(env, "STELLAR_API_URL", DEFAULT_API);
  const ledger = asRecord(await getJson(`${root}/ledgers/${height}`, fetchImpl), "stellar ledger");
  const header = base64ToBytes(String(ledger.header_xdr));
  const computed = bytesToHex(sha256Bytes(header));
  const reported = String(ledger.hash).toLowerCase();
  if (computed !== reported) {
    throw new Error(`Recomputed Stellar ledger hash ${computed} does not match ${reported}.`);
  }
  const successful = Number(ledger.successful_transaction_count ?? 0);
  const failed = Number(ledger.failed_transaction_count ?? 0);
  return {
    height: String(ledger.sequence),
    blockHash: computed,
    parentHash: String(ledger.prev_hash ?? "").toLowerCase(),
    txRoot: "",
    txRootType: "none",
    txCount: successful + failed,
    blockTime: typeof ledger.closed_at === "string" ? ledger.closed_at : null,
    rawHeader: header,
    hashMode: "recomputed",
    headerHash: "stellar-xdr",
    commitments: { txSetHash: String(ledger.tx_set_hash ?? "") },
  };
}

