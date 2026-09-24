import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ETHEREUM_CHAIN_ID, POLYGON_CHAIN_ID, canonicalEvmDocument } from "../src/base.ts";
import {
  canonicalAptosDocument,
  canonicalBitcoinDocument,
  canonicalHederaDocument,
  canonicalNearDocument,
  canonicalSolanaDocument,
  canonicalStellarDocument,
  canonicalSuiDocument,
  canonicalTonDocument,
  hashSourceDocument,
} from "../src/networks.ts";
import { resolveSourceRequest } from "../src/source.ts";

const HEX = "ab".repeat(32);
const SOLANA = "1".repeat(87);

describe("source ids", () => {
  it("requires the named chain to match the transaction id", () => {
    assert.throws(() => resolveSourceRequest(SOLANA), /chain is required/);
    assert.equal(resolveSourceRequest(SOLANA, "solana").chain, "solana");
    assert.equal(resolveSourceRequest("0.0.98@1684234567.000000000", "hedera").chain, "hedera");
    assert.throws(() => resolveSourceRequest(`0x${HEX}`, "solana"), /does not match/);
    assert.equal(resolveSourceRequest(`0x${HEX}`, "ethereum").chain, "ethereum");
    assert.equal(resolveSourceRequest(`0x${HEX}`, "aptos").chain, "aptos");
    assert.equal(resolveSourceRequest(HEX, "bitcoin").txid, HEX);
    assert.equal(resolveSourceRequest(HEX, "stellar").chain, "stellar");
    assert.throws(() => resolveSourceRequest(HEX, "algorand"), /does not match/);
    assert.equal(resolveSourceRequest("1".repeat(44), "sui").chain, "sui");
    assert.equal(resolveSourceRequest("1".repeat(44), "near").chain, "near");
    assert.throws(() => resolveSourceRequest("1".repeat(44), "solana"), /does not match/);
  });
});

describe("canonical source documents", () => {
  it("keeps an EVM chain id and a failed receipt", () => {
    const tx = {
      hash: `0x${HEX}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockNumber: "0x1",
      transactionIndex: "0x0",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: null,
      value: "0x0",
      input: "0x",
      nonce: "0x0",
      gas: "0x1",
      type: "0x2",
    };
    const receipt = {
      transactionHash: `0x${HEX}`,
      blockNumber: "0x1",
      status: "0x0",
      gasUsed: "0x1",
      cumulativeGasUsed: "0x1",
      contractAddress: null,
      logs: [],
    };
    assert.equal(canonicalEvmDocument(ETHEREUM_CHAIN_ID, "Ethereum", `0x${HEX}`, tx, receipt).chainId, 1);
    assert.equal(canonicalEvmDocument(POLYGON_CHAIN_ID, "Polygon", `0x${HEX}`, tx, receipt).chainId, 137);
  });

  it("builds a document id for each non-EVM chain", () => {
    const solana = canonicalSolanaDocument(SOLANA, {
      slot: 1,
      blockTime: 2,
      transaction: { signatures: [SOLANA], message: { instructions: [] } },
      meta: { err: { InstructionError: [0, "Custom"] }, fee: 5000, preBalances: [1], postBalances: [1], logMessages: [] },
    });
    assert.equal(solana.err != null, true);
    assert.equal(hashSourceDocument("Solana", solana).hashSha256.length, 64);

    const bitcoin = canonicalBitcoinDocument(HEX, {
      txid: HEX,
      version: 2,
      locktime: 0,
      vin: [{ txid: HEX, vout: 0, scriptsig: "", sequence: 1, witness: ["aa"] }],
      vout: [{ value: 1, scriptpubkey: "51", scriptpubkey_address: "bc1q" }],
      status: { confirmed: true, block_height: 10, block_hash: "cd".repeat(32) },
    }, 10);
    assert.equal(bitcoin.confirmationCount, 1);
    assert.throws(() => canonicalBitcoinDocument(HEX, { txid: HEX, status: { confirmed: false } }, 10), /not confirmed/);

    assert.equal(canonicalAptosDocument(`0x${HEX}`, { hash: `0x${HEX}`, version: "1", success: false, vm_status: "ok", gas_used: "1", payload: {}, events: [] }).success, false);
    assert.equal(canonicalSuiDocument("1".repeat(44), { digest: "1".repeat(44), checkpoint: "9", effects: { status: { status: "failure" } }, transaction: {}, events: [] }).status, "failure");
    assert.equal(canonicalHederaDocument("0.0.98@1.2", { transactions: [{ transaction_id: "0.0.98@1.2", consensus_timestamp: "1.2", result: "SUCCESS", transfers: [], memo_base64: null }] }).id, "0.0.98@1.2");
    assert.equal(canonicalStellarDocument(HEX, { hash: HEX, ledger: 1, successful: false, fee_charged: "100", operation_count: 1, source_account: "G", memo_type: "none", memo: "", envelope_xdr: "aa" }).successful, false);
    assert.equal(canonicalNearDocument("1".repeat(44), { txns: [{ transaction_hash: "1".repeat(44), signer_account_id: "a.near", receiver_account_id: "b.near", nonce: "1", actions: [], outcomes: { status: true }, block: { block_height: 3 } }] }).blockHeight, "3");
    assert.equal(canonicalTonDocument("abc+/def=", { hash: "abc+/def=", lt: "1", account: { address: "0:aa" }, now: 1, out_msgs: [], description: { aborted: true } }).account, "0:aa");
  });
});
