import { describe, expect, it } from "vitest";

import {
  attestationPage,
  attestationsLatestFirst,
  blockExplorerUrl,
  formatLatency,
  statusCopy,
  timeLeft,
  type ExperimentAttestation,
  type ExperimentDocument,
} from "./model";

function attestation(height: number, attestedAt: string): ExperimentAttestation {
  return {
    height,
    blockHash: null,
    attestTxnId: `txn-${height}`,
    attestedAt,
    paidUsdc: "0.001",
    skipped: false,
  };
}

function document(overrides: Partial<ExperimentDocument> = {}): ExperimentDocument {
  return {
    id: "bitcoin-blocks-24h",
    title: "Bitcoin blocks, 24 hours",
    status: "running",
    preview: false,
    window: { start: "2026-10-16T12:00:00.000Z", end: "2026-10-17T12:00:00.000Z" },
    stats: {
      attested: 1,
      failures: 0,
      usdcSpent: "0.001",
      tip: 100,
      nextHeight: 99,
      lag: 2,
      lastError: null,
    },
    attestations: [],
    ...overrides,
  };
}

describe("experiment status copy", () => {
  it("keeps the Bitcoin 24 hour wording when the chain is absent", () => {
    expect(statusCopy(document())).toBe("Running. Each ready Bitcoin block is attested two behind the tip.");
    expect(statusCopy(document({ status: "complete" }))).toBe("Complete. The 24-hour window has ended.");
  });

  it("describes the Ethereum window and the 30 block paid test", () => {
    expect(statusCopy(document({ chain: "ethereum", status: "running" }))).toBe(
      "Running. Each ready Ethereum block is attested two behind the tip.",
    );
    expect(statusCopy(document({ chain: "ethereum", status: "complete" }))).toBe(
      "Complete. The 6-hour window has ended.",
    );
    expect(
      statusCopy(
        document({
          chain: "ethereum",
          mode: "test",
          status: "running",
          window: null,
          test: { paid: 10, cap: 30 },
        }),
      ),
    ).toBe("Running. Paying for 30 Ethereum blocks, ten at a time, each two behind the tip.");
    expect(timeLeft(document({ mode: "test", status: "running", window: null, test: { paid: 10, cap: 30 } }), 0)).toBe(
      "20 blocks left",
    );
  });

  it("pages attestations latest first, twenty at a time", () => {
    const rows = Array.from({ length: 45 }, (_, index) => attestation(index + 1, `2026-10-21T22:08:${String(index).padStart(2, "0")}.000Z`));
    const latest = attestationsLatestFirst(rows);
    expect(latest[0]?.height).toBe(45);
    expect(latest[44]?.height).toBe(1);

    const first = attestationPage(rows, 1);
    expect(first.pageCount).toBe(3);
    expect(first.rows).toHaveLength(20);
    expect(first.rows[0]?.height).toBe(45);
    expect(first.rows[19]?.height).toBe(26);
    expect(first.from).toBe(1);
    expect(first.to).toBe(20);

    const last = attestationPage(rows, 9);
    expect(last.page).toBe(3);
    expect(last.rows.map((row) => row.height)).toEqual([5, 4, 3, 2, 1]);
    expect(last.from).toBe(41);
    expect(last.to).toBe(45);
  });

  it("links blocks to the chain explorer and formats latency", () => {
    expect(blockExplorerUrl("bitcoin", "aa")).toBe("https://mempool.space/block/aa");
    expect(blockExplorerUrl("ethereum", "0xabc")).toBe("https://etherscan.io/block/0xabc");
    expect(formatLatency(800)).toBe("800 ms");
    expect(formatLatency(1500)).toBe("1.5 s");
    expect(formatLatency(null)).toBe("—");
  });
});
