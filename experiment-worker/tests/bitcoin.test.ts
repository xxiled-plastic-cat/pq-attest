import assert from "node:assert/strict";
import test from "node:test";

import { fetchBitcoinTip, parseBitcoinTip } from "../src/bitcoin.js";

test("parses a mempool tip height", () => {
  assert.equal(parseBitcoinTip("918273\n"), 918273);
});

test("rejects a tip that is not an integer", () => {
  assert.throws(() => parseBitcoinTip("latest"), /not a height/);
  assert.throws(() => parseBitcoinTip(""), /not a height/);
});

test("reads the tip from the block API", async () => {
  const tip = await fetchBitcoinTip("https://mempool.space/api/", async (input) => {
    assert.equal(String(input), "https://mempool.space/api/blocks/tip/height");
    return new Response("42");
  });
  assert.equal(tip, 42);
});

test("surfaces a failed tip response", async () => {
  await assert.rejects(
    () => fetchBitcoinTip("https://mempool.space/api", async () => new Response("no", { status: 503 })),
    /503/,
  );
});
