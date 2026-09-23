import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import algosdk from 'algosdk';
import { canonicalJson, hashTransaction, sha256Hex } from '../src/canonical.ts';
import { attestNote, verifyBundle } from '../src/bundle.ts';
import { pqKeyPair, signBundle } from '../src/pq.ts';
import type { ProofBundle } from '../src/types.ts';

describe('canonical JSON', () => {
  it('sorts object keys and keeps array order', () => {
    const left = canonicalJson({ b: 1, a: { d: [3, 1], c: 'z' } });
    const right = canonicalJson({ a: { c: 'z', d: [3, 1] }, b: 1 });
    assert.equal(left, right);
    assert.equal(left, '{"a":{"c":"z","d":[3,1]},"b":1}');
  });

  it('hashes every field of the transaction document', () => {
    const transaction = {
      id: 'ABC',
      'genesis-id': 'mainnet-v1.0',
      fee: 1000,
      'inner-txns': [{ 'tx-type': 'pay', note: 'aGVsbG8=' }],
      logs: ['one'],
    };
    const hashed = hashTransaction(transaction);
    const again = hashTransaction({
      logs: ['one'],
      fee: 1000,
      'inner-txns': [{ note: 'aGVsbG8=', 'tx-type': 'pay' }],
      'genesis-id': 'mainnet-v1.0',
      id: 'ABC',
    });
    assert.equal(hashed.hashSha256, again.hashSha256);
    assert.equal(sha256Hex(Buffer.from(hashed.txnBytesBase64, 'base64')), hashed.hashSha256);
    assert.match(hashed.canonical, /inner-txns/);
    assert.match(hashed.canonical, /logs/);
    assert.match(hashed.canonical, /aGVsbG8=/);
  });
});

describe('attest note', () => {
  it('builds a short v1 recipe', () => {
    const hash = 'ab'.repeat(32);
    const note = attestNote('OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA', hash);
    assert.equal(
      note,
      `attest:v1:OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA:${hash}`,
    );
    assert.ok(Buffer.byteLength(note, 'utf8') <= 1024);
  });
});

describe('ML-DSA bundle', () => {
  it('accepts a signature over the unsigned fields and rejects a changed hash', async () => {
    const account = algosdk.generateAccount();
    const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
    const keys = pqKeyPair(mnemonic);
    const transaction = {
      id: 'SRC',
      'genesis-id': 'mainnet-v1.0',
      fee: 1000,
      sender: 'SENDER',
    };
    const hashed = hashTransaction(transaction);
    const note = attestNote(transaction.id, hashed.hashSha256);
    const bundle: ProofBundle = {
      version: 1,
      network: 'algorand-mainnet',
      source: {
        txnId: transaction.id,
        hashSha256: hashed.hashSha256,
        txnBytesBase64: hashed.txnBytesBase64,
      },
      attest: {
        txnId: 'ATTEST',
        round: 10,
        note,
      },
      attestor: {
        algorandAddress: account.addr.toString(),
        pqPublicKey: Buffer.from(keys.publicKey).toString('base64'),
      },
      signature: {
        alg: 'ML-DSA-65',
        sigBase64: '',
      },
    };
    bundle.signature.sigBase64 = signBundle(bundle, keys.secretKey);

    await verifyBundle(bundle);

    const tampered = structuredClone(bundle);
    tampered.source.hashSha256 = 'cd'.repeat(32);
    tampered.attest.note = attestNote(transaction.id, tampered.source.hashSha256);
    await assert.rejects(() => verifyBundle(tampered), /ML-DSA-65 signature rejected/);
  });
});
