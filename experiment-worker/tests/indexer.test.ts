import assert from "node:assert/strict";
import test from "node:test";

import type { ChainClients } from "../src/chain.js";
import { ATTESTOR_ADDRESS, blockNotePrefix } from "../src/constants.js";
import { existingAttestFromPage, findBitcoinBlockAttest } from "../src/indexer.js";

type AttestIndexer = ChainClients["indexer"];

test("reads an existing bitcoin block note from the indexer page", () => {
  const note = encodeNote(`${blockNotePrefix(900000)}${"ab".repeat(32)}`);
  const found = existingAttestFromPage(
    { transactions: [{ id: "ATTXN", note }, { id: "OTHER", note: encodeNote("attest:v1:nope") }] },
    900000,
  );
  assert.deepEqual(found, { txnId: "ATTXN", blockHash: "ab".repeat(32) });
});

test("reads an ethereum block note that includes the 0x hash", () => {
  const hash = `0x${"ab".repeat(32)}`;
  const note = encodeNote(`${blockNotePrefix(26050068, "ethereum")}${hash}`);
  const found = existingAttestFromPage({ transactions: [{ id: "ATTXN", note }] }, 26050068, "ethereum");
  assert.deepEqual(found, { txnId: "ATTXN", blockHash: hash });
});

test("returns null when the height has no attestor note", () => {
  assert.equal(existingAttestFromPage({ transactions: [] }, 900000), null);
  assert.equal(existingAttestFromPage({}, 900000), null);
});

test("searches the attestor notes for one height through the indexer client", async () => {
  let params: { address?: string; addressRole?: string; notePrefix?: string; limit?: number } | undefined;
  const indexer = {
    async searchForTransactions(query: { address?: string; addressRole?: string; notePrefix?: string; limit?: number }) {
      params = query;
      return {
        currentRound: 1n,
        transactions: [
          {
            id: "FOUND",
            note: new TextEncoder().encode(`${blockNotePrefix(15)}ff`),
            sender: ATTESTOR_ADDRESS,
            fee: 1000n,
            firstValid: 1n,
            lastValid: 1000n,
            txType: "pay" as const,
          },
        ],
      };
    },
  } as unknown as AttestIndexer;
  const found = await findBitcoinBlockAttest({ indexer, height: 15 });
  assert.equal(params?.address, ATTESTOR_ADDRESS);
  assert.equal(params?.addressRole, "sender");
  assert.equal(params?.notePrefix, encodeNote(blockNotePrefix(15)));
  assert.equal(params?.limit, 10);
  assert.deepEqual(found, { txnId: "FOUND", blockHash: "ff" });
});

function encodeNote(note: string): string {
  const bytes = new TextEncoder().encode(note);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
