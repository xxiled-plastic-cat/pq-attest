import { DurableObject } from "cloudflare:workers";

import { fetchBitcoinTip } from "./bitcoin.js";
import { createChainClients } from "./chain.js";
import { ETHEREUM_BURST, ETHEREUM_EXPERIMENT_ID, ETHEREUM_WINDOW_MS, experimentObjectName } from "./constants.js";
import {
  ETHEREUM_PROFILE,
  previewBundle,
  previewDocument,
  previewEthereumDocument,
  toDocument,
  type ExperimentDocument,
  type ExperimentProfile,
} from "./document.js";
import { DEFAULT_ETH_RPC_URL, fetchEthereumTip } from "./ethereum.js";
import { findBitcoinBlockAttest, findBlockAttest } from "./indexer.js";
import { payForBitcoinBlock, payForBlock } from "./pay.js";
import {
  emptyState,
  nextAlarmDelay,
  parseEthereumRun,
  parseExperimentRun,
  parseState,
  runBurst,
  runTick,
  type ExperimentRun,
  type RunState,
  type TickDeps,
  type TickOutcome,
} from "./run.js";

export interface ExperimentEnv {
  EXPERIMENT_RUN: string;
  EXPERIMENT_EPOCH?: string;
  EXPERIMENT_PREVIEW?: string;
  ETHEREUM_EXPERIMENT_RUN?: string;
  ETHEREUM_EXPERIMENT_EPOCH?: string;
  /** Earlier Ethereum run. Read at /ethereum/archive. The cron does not wake it. */
  ETHEREUM_EXPERIMENT_ARCHIVE_EPOCH?: string;
  API_URL: string;
  BITCOIN_API_URL: string;
  ETH_RPC_URL?: string;
  ALGOD_URL: string;
  ALGOD_TOKEN?: string;
  INDEXER_URL: string;
  INDEXER_TOKEN?: string;
  PAYER_MNEMONIC?: string;
  BITCOIN_BLOCK_RUN: DurableObjectNamespace<BitcoinBlockRun>;
  ETHEREUM_BLOCK_RUN: DurableObjectNamespace<EthereumBlockRun>;
}

class BlockRun extends DurableObject<ExperimentEnv> {
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

  async bundle(height: number): Promise<unknown | null> {
    const rows = this.ctx.storage.sql
      .exec<{ body: string }>("SELECT body FROM bundle WHERE height = ?", height)
      .toArray();
    const row = rows[0];
    if (!row) {
      return null;
    }
    return JSON.parse(row.body) as unknown;
  }

  protected load(): RunState {
    const rows = this.ctx.storage.sql
      .exec<{ body: string }>("SELECT body FROM run_state WHERE id = 1")
      .toArray();
    const row = rows[0];
    if (!row) {
      return emptyState();
    }
    return parseState(row.body);
  }

  protected save(before: RunState, outcome: TickOutcome): void {
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

  protected payer(): string {
    return this.env.PAYER_MNEMONIC ?? "";
  }

  protected chain() {
    return createChainClients({
      algodUrl: this.env.ALGOD_URL,
      indexerUrl: this.env.INDEXER_URL,
      algodToken: this.env.ALGOD_TOKEN,
      indexerToken: this.env.INDEXER_TOKEN,
    });
  }
}

export class BitcoinBlockRun extends BlockRun {
  async tick(): Promise<void> {
    if (this.env.EXPERIMENT_PREVIEW === "1") {
      console.log(JSON.stringify({ event: "experiment_tick", skipped: "preview" }));
      return;
    }
    const run = parseExperimentRun(this.env.EXPERIMENT_RUN);
    const before = this.load();
    const outcome = await runTick(before, run, this.deps());
    this.save(before, outcome);
    console.log(
      JSON.stringify({
        event: "experiment_tick",
        chain: "bitcoin",
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
    return super.bundle(height);
  }

  private deps(): TickDeps {
    const chain = this.chain();
    return {
      now: () => new Date(),
      tip: () => fetchBitcoinTip(this.env.BITCOIN_API_URL, fetch),
      findExisting: (height) =>
        findBitcoinBlockAttest({
          indexer: chain.indexer,
          height,
        }),
      pay: (height) =>
        payForBitcoinBlock({
          apiUrl: this.env.API_URL,
          algorand: chain.algorand,
          mnemonic: this.payer(),
          height,
          fetchImpl: fetch,
        }),
    };
  }
}

export class EthereumBlockRun extends BlockRun {
  async alarm(): Promise<void> {
    try {
      if (this.env.EXPERIMENT_PREVIEW === "1") {
        console.log(JSON.stringify({ event: "experiment_tick", chain: "ethereum", skipped: "preview" }));
        return;
      }
      await this.burst();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "experiment_tick_failed",
          chain: "ethereum",
          message: error instanceof Error ? error.message : "Tick failed.",
        }),
      );
    }
    await this.arm();
  }

  async kick(): Promise<void> {
    if (this.env.EXPERIMENT_PREVIEW === "1") {
      return;
    }
    const run = this.run();
    if (run === "stop" || this.load().complete) {
      return;
    }
    const pending = await this.ctx.storage.getAlarm();
    if (pending === null) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  async snapshot(profile: ExperimentProfile = ETHEREUM_PROFILE, run?: ExperimentRun): Promise<ExperimentDocument> {
    if (this.env.EXPERIMENT_PREVIEW === "1") {
      return previewEthereumDocument(new Date(), profile);
    }
    return toDocument(this.load(), run ?? this.run(), new Date(), profile);
  }

  async bundle(height: number): Promise<unknown | null> {
    if (this.env.EXPERIMENT_PREVIEW === "1") {
      return previewBundle(height, "ethereum");
    }
    return super.bundle(height);
  }

  private async burst(): Promise<void> {
    const run = this.run();
    const before = this.load();
    const outcome = await runBurst(before, run, this.deps(), ETHEREUM_BURST, (stepBefore, step) => {
      this.save(stepBefore, step);
      this.logHeight(stepBefore, step);
    });
    this.save(before, { state: outcome.state, bundle: null });
    console.log(
      JSON.stringify({
        event: "experiment_burst",
        chain: "ethereum",
        run,
        paid: outcome.bundles.length,
        nextHeight: outcome.state.nextHeight,
        attested: outcome.state.attestations.length,
        failures: outcome.state.failureCount,
        lastError: outcome.state.lastError,
        complete: outcome.state.complete,
        mode: outcome.state.mode,
      }),
    );
  }

  private async arm(): Promise<void> {
    const delay = nextAlarmDelay(this.load(), this.run());
    if (delay === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  private run(): ExperimentRun {
    return parseEthereumRun(this.env.ETHEREUM_EXPERIMENT_RUN);
  }

  private deps(): TickDeps {
    const chain = this.chain();
    return {
      now: () => new Date(),
      windowMs: ETHEREUM_WINDOW_MS,
      tip: () => fetchEthereumTip(this.env.ETH_RPC_URL ?? DEFAULT_ETH_RPC_URL, fetch),
      findExisting: (height) =>
        findBlockAttest({
          indexer: chain.indexer,
          chain: "ethereum",
          height,
        }),
      pay: (height) =>
        payForBlock({
          apiUrl: this.env.API_URL,
          algorand: chain.algorand,
          mnemonic: this.payer(),
          chain: "ethereum",
          height,
          fetchImpl: fetch,
        }),
    };
  }

  private logHeight(before: RunState, outcome: TickOutcome): void {
    const added = outcome.state.attestations.length > before.attestations.length;
    const row = added ? outcome.state.attestations[outcome.state.attestations.length - 1] : undefined;
    console.log(
      JSON.stringify({
        event: "experiment_attest",
        chain: "ethereum",
        height: row?.height ?? before.nextHeight,
        elapsedMs: row?.elapsedMs ?? null,
        paidAtomic: row?.paidAtomic ?? null,
        error: added ? null : outcome.state.lastError,
      }),
    );
  }
}

export function experimentStub(env: ExperimentEnv): DurableObjectStub<BitcoinBlockRun> {
  return env.BITCOIN_BLOCK_RUN.getByName(experimentObjectName(env.EXPERIMENT_EPOCH));
}

export function ethereumStub(
  env: ExperimentEnv,
  epoch = env.ETHEREUM_EXPERIMENT_EPOCH,
): DurableObjectStub<EthereumBlockRun> {
  return env.ETHEREUM_BLOCK_RUN.getByName(experimentObjectName(epoch, ETHEREUM_EXPERIMENT_ID));
}
