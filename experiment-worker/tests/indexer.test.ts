import assert from "node:assert/strict";
import test from "node:test";

import { ATTESTOR_ADDRESS, blockNotePrefix } from "../src/constants.js";
import { existingAttestFromPage, findBitcoinBlockAttest } from "../src/indexer.js";

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

test("calls fetch as a free function so Workers keeps the global this", async () => {
  let receiver: unknown = "unset";
  await findBitcoinBlockAttest({
    indexerUrl: "https://mainnet-idx.algonode.cloud",
    height: 15,
    fetchImpl: function (this: unknown) {
      receiver = this;
      return Promise.resolve(Response.json({ transactions: [] }));
    } as typeof fetch,
  });
  assert.equal(receiver, undefined);
});

test("searches the attestor notes for one height", async () => {
  const found = await findBitcoinBlockAttest({
    indexerUrl: "https://mainnet-idx.algonode.cloud",
    height: 15,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("address"), ATTESTOR_ADDRESS);
      assert.equal(url.searchParams.get("address-role"), "sender");
      assert.equal(url.searchParams.get("note-prefix"), encodeNote(blockNotePrefix(15)));
      return Response.json({
        transactions: [{ id: "FOUND", note: encodeNote(`${blockNotePrefix(15)}ff`) }],
      });
    },
  });
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
