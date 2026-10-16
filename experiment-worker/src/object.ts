import { DurableObject } from "cloudflare:workers";

import { fetchBitcoinTip } from "./bitcoin.js";
import { EXPERIMENT_ID } from "./constants.js";
import { previewBundle, previewDocument, toDocument, type ExperimentDocument } from "./document.js";
import { findBitcoinBlockAttest } from "./indexer.js";
import { payForBitcoinBlock } from "./pay.js";
import { emptyState, parseExperimentRun, parseState, runTick, type RunState, type TickOutcome } from "./run.js";

export interface ExperimentEnv {
  EXPERIMENT_RUN: string;
  EXPERIMENT_PREVIEW?: string;
  API_URL: string;
  BITCOIN_API_URL: string;
  ALGOD_URL: string;
  INDEXER_URL: string;
  PAYER_MNEMONIC?: string;
  BITCOIN_BLOCK_RUN: DurableObjectNamespace<BitcoinBlockRun>;
}

export class BitcoinBlockRun extends DurableObject<ExperimentEnv> {
  constructor(ctx: DurableObjectState, env: ExperimentEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS run_state (
          id INTEGER PRIMARY KEY,
          body TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS bundle (
          height INTEGER PRIMARY KEY,
          body TEXT NOT NULL
        )
      `);
    });
  }

  async tick(): Promise<void> {
    if (this.env.EXPERIMENT_PREVIEW === "1") {
      console.log(JSON.stringify({ event: "experiment_tick", skipped: "preview" }));
      return;
    }
    const run = parseExperimentRun(this.env.EXPERIMENT_RUN);
    const before = this.load();
    const outcome = await runTick(before, run, {
      now: () => new Date(),
      tip: () => fetchBitcoinTip(this.env.BITCOIN_API_URL, fetch),
      findExisting: (height) =>
        findBitcoinBlockAttest({
          indexerUrl: this.env.INDEXER_URL,
          height,
          fetchImpl: fetch,
        }),
      pay: (height) =>
        payForBitcoinBlock({
          apiUrl: this.env.API_URL,
          algodUrl: this.env.ALGOD_URL,
          mnemonic: this.env.PAYER_MNEMONIC ?? "",
          height,
          fetchImpl: fetch,
        }),
    });
    this.save(before, outcome);
    console.log(
      JSON.stringify({
        event: "experiment_tick",
        run,
        nextHeight: outcome.state.nextHeight,
        attested: outcome.state.attestations.length,
        failures: outcome.state.failureCount,
        lastError: outcome.state.lastError,
        complete: outcome.state.complete,
      }),
    );
  }

  async snapshot(): Promise<ExperimentDocument> {
    if (this.env.EXPERIMENT_PREVIEW === "1") {
      return previewDocument(new Date());
    }
    return toDocument(this.load(), parseExperimentRun(this.env.EXPERIMENT_RUN), new Date());
  }

  async bundle(height: number): Promise<unknown | null> {
    if (this.env.EXPERIMENT_PREVIEW === "1") {
      return previewBundle(height);
    }
    const rows = this.ctx.storage.sql
      .exec<{ body: string }>("SELECT body FROM bundle WHERE height = ?", height)
      .toArray();
    const row = rows[0];
    if (!row) {
      return null;
    }
    return JSON.parse(row.body) as unknown;
  }

  private load(): RunState {
    const rows = this.ctx.storage.sql
      .exec<{ body: string }>("SELECT body FROM run_state WHERE id = 1")
      .toArray();
    const row = rows[0];
    if (!row) {
      return emptyState();
    }
    return parseState(row.body);
  }

  private save(before: RunState, outcome: TickOutcome): void {
    const next = JSON.stringify(outcome.state);
    if (next === JSON.stringify(before) && outcome.bundle === null) {
      return;
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO run_state (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
        next,
      );
      if (outcome.bundle) {
        this.ctx.storage.sql.exec(
          "INSERT INTO bundle (height, body) VALUES (?, ?) ON CONFLICT(height) DO UPDATE SET body = excluded.body",
          outcome.bundle.height,
          JSON.stringify(outcome.bundle.body),
        );
      }
    });
  }
}

export function experimentStub(env: ExperimentEnv): DurableObjectStub<BitcoinBlockRun> {
  return env.BITCOIN_BLOCK_RUN.getByName(EXPERIMENT_ID);
}
