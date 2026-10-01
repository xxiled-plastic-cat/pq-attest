import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import { falconAccountFromSeed, falconSeedFromHex } from "../src/accounts.ts";
import { blockAttestNote } from "../src/block/verify.ts";
import { attestNote } from "../src/bundle.ts";
import {
  ATTEST_NOTE_PREFIX,
  BLOCK_ATTEST_NOTE_PREFIX,
} from "../src/stats/attestations.ts";
import { buildStatsDocument, packageVersion, supportedNetworks } from "../src/stats/document.ts";
import { collectStats, publishStats } from "../src/stats/publish.ts";
import { uploadStats } from "../src/stats/upload.ts";

const SEED = "ab".repeat(48);
const TOKEN = "super-secret-token";
const NOW = new Date("2026-10-01T19:00:00.000Z");
const INDEXER = "https://indexer.example/idx/";
const UPLOAD = "https://stats.example/upload/pq-attest";

const env = {
  INDEXER_URL: INDEXER,
  ATTESTOR_FALCON_SEED: SEED,
  NF_STATS_URL: UPLOAD,
  NF_STATS_TOKEN: TOKEN,
};

function href(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("stats document", () => {
  it("builds nf-stats/v1 from indexer pages", async () => {
    const address = falconAccountFromSeed(falconSeedFromHex(SEED)).address;
    const attestPrefix = Buffer.from(ATTEST_NOTE_PREFIX, "utf8").toString("base64");
    const blockPrefix = Buffer.from(BLOCK_ATTEST_NOTE_PREFIX, "utf8").toString("base64");
    const calls: URL[] = [];

    const document = await collectStats({
      env,
      now: NOW,
      fetchImpl: async (input) => {
        const url = new URL(href(input));
        calls.push(url);
        const prefix = url.searchParams.get("note-prefix");
        const next = url.searchParams.get("next");
        if (prefix === attestPrefix && !next) {
          return jsonResponse({
            transactions: [{ id: "a" }, { id: "b" }],
            "next-token": "page-2",
          });
        }
        if (prefix === attestPrefix && next === "page-2") {
          return jsonResponse({ transactions: [{ id: "c" }] });
        }
        if (prefix === blockPrefix) {
          return jsonResponse({ transactions: [{ id: "d" }] });
        }
        return jsonResponse({ transactions: [] });
      },
    });

    assert.equal(calls.length, 3);
    for (const url of calls) {
      assert.equal(url.origin + url.pathname, "https://indexer.example/idx/v2/transactions");
      assert.equal(url.searchParams.get("address"), address);
      assert.equal(url.searchParams.get("address-role"), "sender");
      assert.equal(url.searchParams.get("limit"), "1000");
    }
    assert.equal(calls[1]?.searchParams.get("next"), "page-2");

    assert.equal(document.schema, "nf-stats/v1");
    assert.equal(document.project, "pq-attest");
    assert.equal(document.name, "PQ Attest");
    assert.equal(document.status, "live");
    assert.equal(document.version, packageVersion());
    assert.equal(document.url, "https://pqattest.com");
    assert.equal(document.updated_at, "2026-10-01T19:00:00.000Z");
    assert.equal("released_at" in document, false);
    assert.deepEqual(document.networks, supportedNetworks());
    assert.equal(document.stats.length, 2);

    const attestations = document.stats[0];
    const networks = document.stats[1];
    assert.ok(attestations);
    assert.ok(networks);
    assert.equal(attestations.id, "attestations_total");
    assert.equal(attestations.value, 4);
    assert.equal(typeof attestations.value, "number");
    assert.equal(attestations.unit, "count");
    assert.equal(attestations.period, "all_time");
    assert.equal(attestations.as_of, document.updated_at);
    assert.equal(attestations.source, "Attest transactions written by the service");
    assert.equal(networks.id, "networks_supported");
    assert.equal(networks.value, document.networks.length);
    assert.equal(typeof networks.value, "number");
    assert.equal(networks.unit, "chains");
    assert.equal(networks.period, "current");
    assert.equal(document.stats.some((stat) => stat.id === "verifications_30d"), false);
    assert.equal(JSON.stringify(document).includes(TOKEN), false);
    assert.equal(JSON.stringify(document).includes(SEED), false);
  });

  it("searches the note prefixes the service writes", () => {
    assert.equal(attestNote("TXID", "ab".repeat(32)).startsWith(ATTEST_NOTE_PREFIX), true);
    assert.equal(blockAttestNote("algorand", "10", "hash").startsWith(BLOCK_ATTEST_NOTE_PREFIX), true);
    assert.equal(BLOCK_ATTEST_NOTE_PREFIX.startsWith(ATTEST_NOTE_PREFIX), false);
  });

  it("does not upload when the indexer count fails", async () => {
    const calls: string[] = [];
    await assert.rejects(
      () =>
        publishStats({
          env,
          now: NOW,
          fetchImpl: async (input) => {
            calls.push(href(input));
            return new Response("unavailable", { status: 503 });
          },
        }),
      /Indexer attestation search failed \(503\)/,
    );
    assert.deepEqual(calls, [`${INDEXER}v2/transactions?address=${falconAccountFromSeed(falconSeedFromHex(SEED)).address}&address-role=sender&note-prefix=${encodeURIComponent(Buffer.from(ATTEST_NOTE_PREFIX, "utf8").toString("base64"))}&limit=1000`]);
    assert.equal(calls.some((url) => url.startsWith(UPLOAD)), false);
  });
});

describe("stats upload", () => {
  const document = buildStatsDocument(4, NOW);

  it("accepts HTTP 200 with body ok", async () => {
    let calls = 0;
    await uploadStats(document, {
      env,
      sleep: async () => {
        throw new Error("should not retry");
      },
      fetchImpl: async (_input, init) => {
        calls += 1;
        assert.equal(init?.method, "PUT");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
        assert.equal(headers.get("content-type"), "application/json");
        const sent = JSON.parse(String(init?.body)) as { stats: Array<{ value: number }> };
        assert.equal(sent.stats[0]?.value, 4);
        return new Response("ok\n", { status: 200 });
      },
    });
    assert.equal(calls, 1);
  });

  it("retries a 500 and then accepts ok", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await uploadStats(document, {
      env,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("unavailable", { status: 500 });
        }
        return new Response("ok", { status: 200 });
      },
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1000]);
  });

  it("does not retry a 400", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await assert.rejects(
      () =>
        uploadStats(document, {
          env,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          fetchImpl: async () => {
            calls += 1;
            return new Response(`rejected ${TOKEN}`, { status: 400 });
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Stats upload rejected \(400\): rejected \[redacted\]/);
        assert.equal(error.message.includes(TOKEN), false);
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it("retries a network error up to 3 times and then stops", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await assert.rejects(
      () =>
        uploadStats(document, {
          env,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          fetchImpl: async () => {
            calls += 1;
            throw new Error(`connect ${TOKEN}`);
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Stats upload failed: connect \[redacted\]/);
        assert.equal(error.message.includes(TOKEN), false);
        return true;
      },
    );
    assert.equal(calls, 4);
    assert.deepEqual(sleeps, [1000, 2000, 4000]);
  });
});
