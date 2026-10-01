import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAccount, secretKeyToMnemonic } from "algosdk";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import test from "node:test";
import { assertInclusionSupported } from "../src/block/adapter.ts";
import { blockCapabilities } from "../src/block/capabilities.ts";
import { bitcoinMerkleProof, merkleRoot, verifyBitcoinMerkle } from "../src/block/bitcoin.ts";
import { bytesToBase64, hexToBytes, utf8 } from "../src/block/bytes.ts";
import { parseBlockAttestBody, parseProveBody } from "../src/block/bundle.ts";
import { emptyTrieRootHex, verifyEvmInclusion } from "../src/block/mpt.ts";
import { canonicalJson } from "../src/canonical.ts";
import { pqKeyPair } from "../src/pq.ts";
import { blockAttestMessage, recomputeHeaderHash, verifyBlockOffline, verifyInclusionOffline } from "../src/block/verify.ts";
import type { BlockAttestBundle, UnsignedBlockAttest } from "../src/block/types.ts";

test("capabilities refuse inclusion where there is no transaction root", () => {
  for (const chain of ["solana", "stellar", "aptos", "ton", "hedera", "sui", "xrpl"] as const) {
    assert.equal(blockCapabilities(chain).inclusionProof, "unsupported");
    assert.throws(() => assertInclusionSupported(chain), /inclusion|proof|refused|does not/i);
  }
  assert.equal(blockCapabilities("bitcoin").inclusionProof, "rebuilt");
  assert.equal(blockCapabilities("algorand").inclusionProof, "native");
});

test("a request attests one block", () => {
  assert.throws(() => parseBlockAttestBody({ chain: "base", height: 1, toHeight: 2 }), /one block/);
  assert.throws(() => parseBlockAttestBody({ chain: "ethereum", height: "latest" }), /integer/);
  const parsed = parseBlockAttestBody({ chain: "ethereum", height: 18_000_000 });
  assert.equal(parsed.height, "18000000");
  assert.throws(() => parseProveBody({ chain: "solana", txId: "A".repeat(88), height: "latest" }), /integer/);
});

test("an empty trie root is the keccak of an empty string", () => {
  assert.equal(emptyTrieRootHex(), "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421");
});

test("a Bitcoin merkle branch reaches the header root and rejects a swapped transaction", () => {
  const txids = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  ];
  const root = merkleRoot(txids);
  const proof = bitcoinMerkleProof(txids, txids[1]!);
  assert.equal(verifyBitcoinMerkle(root, proof).ok, true);
  assert.equal(verifyBitcoinMerkle(root, { ...proof, txid: txids[0]! }).ok, false);
});

test("offline verification accepts a signed block bundle and rejects tampering", () => {
  const mnemonic = secretKeyToMnemonic(generateAccount().sk);
  const keys = pqKeyPair(mnemonic);
  const record = canonicalJson({
    blockHash: "slot-hash",
    parentHash: "parent",
    height: "10",
    slot: 10,
  });
  const unsigned: UnsignedBlockAttest = {
    schema: "block-attest-v1",
    chainFamily: "solana",
    chain: "solana",
    network: blockCapabilities("solana").network,
    height: "10",
    blockHash: "slot-hash",
    parentHash: "parent",
    txRoot: "",
    txRootType: "none",
    txCount: 0,
    timestamp: { blockTime: null, attestedAt: "2026-10-01T00:00:00.000Z" },
    rawHeader: bytesToBase64(utf8(record)),
    hashMode: "reported",
    headerHash: "reported",
    anchor: { txnId: "ANCHOR", round: 1, note: "block-attest:v1:solana:10:slot-hash" },
    attestor: {
      algorandAddress: "SENDER",
      pqPublicKey: Buffer.from(keys.publicKey).toString("base64"),
    },
  };
  const signature = Buffer.from(ml_dsa65.sign(blockAttestMessage(unsigned), keys.secretKey)).toString("base64");
  const bundle: BlockAttestBundle = { ...unsigned, signature: { alg: "ML-DSA-65", sigBase64: signature } };
  const ok = verifyBlockOffline(bundle);
  assert.equal(ok.ok, true, ok.checks.map((check) => check.reason).join("; "));

  const tamperedHeader = verifyBlockOffline({
    ...bundle,
    rawHeader: bytesToBase64(utf8(canonicalJson({ ...JSON.parse(record), blockHash: "other" }))),
  });
  assert.equal(tamperedHeader.ok, false);

  const wrongHeight = verifyBlockOffline({ ...bundle, height: "11" });
  assert.equal(wrongHeight.ok, false);

  const badSignature = verifyBlockOffline({
    ...bundle,
    signature: { alg: "ML-DSA-65", sigBase64: bytesToBase64(new Uint8Array(3309)) },
  });
  assert.equal(badSignature.ok, false);

  const otherNetwork = verifyBlockOffline({ ...bundle, network: "algorand:mainnet-v1.0" });
  assert.equal(otherNetwork.ok, false);

  const inclusion = verifyInclusionOffline({
    schema: "tx-inclusion-v1",
    chainFamily: "solana",
    chain: "solana",
    network: bundle.network,
    height: bundle.height,
    txId: "tx",
    leaf: { type: "none", description: "unsupported" },
    proof: { type: "evm-mpt-keccak", keyHex: "00", valueHex: "00", nodes: [] },
    blockAttest: bundle,
  });
  assert.equal(inclusion.ok, false);
  assert.ok(inclusion.checks.some((check) => check.name === "hashType" && !check.ok));
});

test("golden block headers recompute, and a flipped header byte does not", () => {
  const files = readdirSync(new URL("./fixtures/blocks/", import.meta.url)).filter((name) => name.endsWith(".json") && !name.includes("inclusion"));
  assert.ok(files.length >= 16);
  for (const name of files) {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/blocks/${name}`, import.meta.url), "utf8")) as {
      blockHash: string;
      hashMode: "recomputed" | "reported";
      headerHash: "evm-keccak" | "algo-bh" | "btc-dsha256" | "xrpl-lwr" | "stellar-xdr" | "reported";
      rawHeader: string;
    };
    const computed = recomputeHeaderHash({
      rawHeader: fixture.rawHeader,
      headerHash: fixture.headerHash,
      blockHash: fixture.blockHash,
      hashMode: fixture.hashMode,
    } as never);
    if (fixture.hashMode === "recomputed") {
      assert.equal(computed.toLowerCase(), fixture.blockHash.toLowerCase(), name);
      const raw = Buffer.from(fixture.rawHeader, "base64");
      raw[0] = raw[0]! ^ 0xff;
      const tampered = recomputeHeaderHash({
        rawHeader: raw.toString("base64"),
        headerHash: fixture.headerHash,
        blockHash: fixture.blockHash,
        hashMode: fixture.hashMode,
      } as never);
      assert.notEqual(tampered.toLowerCase(), fixture.blockHash.toLowerCase(), name);
    } else {
      const text = Buffer.from(fixture.rawHeader, "base64").toString("utf8");
      const parsed = JSON.parse(text) as { blockHash?: string };
      assert.equal(canonicalJson(parsed), text, name);
      assert.equal(parsed.blockHash, fixture.blockHash, name);
    }
  }
});

test("golden inclusion proofs match the captured transaction roots", () => {
  const optimism = JSON.parse(readFileSync(new URL("./fixtures/blocks/optimism.json", import.meta.url), "utf8")) as { txRoot: string };
  const optimismProof = JSON.parse(readFileSync(new URL("./fixtures/blocks/optimism-inclusion.json", import.meta.url), "utf8")) as {
    proof: { proof: { keyHex: string; valueHex: string; nodes: string[] } };
  };
  assert.equal(verifyEvmInclusion(optimism.txRoot, optimismProof.proof.proof).ok, true);
  const broken = { ...optimismProof.proof.proof, nodes: optimismProof.proof.proof.nodes.slice(0, -1) };
  assert.equal(verifyEvmInclusion(optimism.txRoot, broken).ok, false);

  const bitcoin = JSON.parse(readFileSync(new URL("./fixtures/blocks/bitcoin.json", import.meta.url), "utf8")) as { txRoot: string };
  const bitcoinProof = JSON.parse(readFileSync(new URL("./fixtures/blocks/bitcoin-inclusion.json", import.meta.url), "utf8")) as {
    txId: string;
    proof: { proof: { index: number; siblings: string[] } };
  };
  assert.equal(
    verifyBitcoinMerkle(hexToBytes(bitcoin.txRoot), { ...bitcoinProof.proof.proof, txid: bitcoinProof.txId }).ok,
    true,
  );
});

test("the block verifier CLI accepts a signed fixture and rejects a tampered copy", () => {
  const cli = new URL("../packages/verify/bin/verify-block.ts", import.meta.url);
  const fixture = new URL("./fixtures/blocks/solana-bundle.json", import.meta.url);
  const passed = spawnSync(process.execPath, [cli.pathname, fixture.pathname], { encoding: "utf8" });
  assert.equal(passed.status, 0, passed.stderr || passed.stdout);
  const tampered = JSON.parse(readFileSync(fixture, "utf8")) as { height: string };
  tampered.height = "1";
  const copy = join(tmpdir(), "pq-attest-tampered-block.json");
  writeFileSync(copy, JSON.stringify(tampered));
  const failed = spawnSync(process.execPath, [cli.pathname, copy], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /fail/);
});
