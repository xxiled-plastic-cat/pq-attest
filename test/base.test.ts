import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AlgorandClient } from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import { canonicalBaseDocument, fetchBaseTransaction, hashBaseDocument } from '../src/base.ts';
import { attestNote, loadAttestationSource, verifyBundle } from '../src/bundle.ts';
import { canonicalJson } from '../src/canonical.ts';
import { pqKeyPair, signBundle } from '../src/pq.ts';
import { resolveSourceRequest } from '../src/source.ts';
import type { ProofBundle } from '../src/types.ts';

const HASH = `0x${'ab'.repeat(32)}`;
const BLOCK = `0x${'cd'.repeat(32)}`;
const TOPIC = `0x${'11'.repeat(32)}`;

function transaction(extra: Record<string, unknown> = {}) {
  return {
    hash: `0x${'AB'.repeat(32)}`,
    blockHash: BLOCK,
    blockNumber: '0x10',
    transactionIndex: '0x1',
    from: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    to: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    value: '0x0',
    input: '0xAb',
    nonce: '0x2',
    gas: '0x5208',
    gasPrice: '0x3b9aca00',
    type: '0x2',
    maxFeePerGas: '0x3b9aca00',
    maxPriorityFeePerGas: '0x1',
    yParity: '0x1',
    ...extra,
  };
}

function receipt(extra: Record<string, unknown> = {}) {
  return {
    transactionHash: HASH,
    blockNumber: '0x10',
    status: '0x1',
    gasUsed: '0x5208',
    cumulativeGasUsed: '0x5208',
    contractAddress: null,
    logs: [
      {
        address: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        topics: [TOPIC],
        data: '0x',
        logIndex: '0x0',
        blockNumber: '0x10',
      },
    ],
    ...extra,
  };
}

describe('source request', () => {
  it('infers Base and Algorand ids and rejects a mismatch', () => {
    assert.deepEqual(resolveSourceRequest(`0x${'AB'.repeat(32)}`), { txid: HASH, chain: 'base' });
    assert.deepEqual(resolveSourceRequest('OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA'), {
      txid: 'OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA',
      chain: 'algorand',
    });
    assert.throws(() => resolveSourceRequest(HASH, 'algorand'), /does not match/);
    assert.throws(() => resolveSourceRequest('not-a-txid'), /txid must be/);
  });
});

describe('base canonical document', () => {
  it('drops extra fields, lowercases hex, and hashes stably', () => {
    const left = canonicalBaseDocument(HASH, transaction({ hash: `0x${'AB'.repeat(32)}` }), receipt());
    const right = canonicalBaseDocument(HASH, transaction({ accessList: [] }), receipt({ logsBloom: '0x00' }));
    assert.equal(canonicalJson(left), canonicalJson(right));
    assert.equal(left.hash, HASH);
    assert.equal(left.from, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(left.input, '0xab');
    assert.equal(left.chainId, 8453);
    assert.equal(hashBaseDocument(left).hashSha256, hashBaseDocument(right).hashSha256);
    const note = attestNote(HASH, hashBaseDocument(left).hashSha256);
    assert.ok(Buffer.byteLength(note, 'utf8') <= 1024);
    assert.match(note, new RegExp(`^attest:v1:${HASH}:`));
  });

  it('allows a failed transaction and rejects one that is still pending', () => {
    const failed = canonicalBaseDocument(HASH, transaction(), receipt({ status: '0x0' }));
    assert.equal(failed.status, '0x0');
    assert.throws(
      () => canonicalBaseDocument(HASH, transaction({ blockNumber: null, blockHash: null }), receipt()),
      /not confirmed/,
    );
  });
});

describe('base bundle', () => {
  it('verifies a chain-less Algorand bundle and a Base bundle, including a re-fetch', async () => {
    const account = algosdk.generateAccount();
    const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
    const keys = pqKeyPair(mnemonic);
    const document = canonicalBaseDocument(HASH, transaction(), receipt());
    const hashed = hashBaseDocument(document);
    const note = attestNote(HASH, hashed.hashSha256);
    const bundle: ProofBundle = {
      version: 1,
      network: 'algorand-mainnet',
      source: {
        chain: 'base',
        txnId: HASH,
        hashSha256: hashed.hashSha256,
        txnBytesBase64: hashed.txnBytesBase64,
      },
      attest: { txnId: 'ATTEST', round: 10, note },
      attestor: {
        algorandAddress: account.addr.toString(),
        pqPublicKey: Buffer.from(keys.publicKey).toString('base64'),
      },
      signature: { alg: 'ML-DSA-65', sigBase64: '' },
    };
    bundle.signature.sigBase64 = signBundle(bundle, keys.secretKey);
    const verified = await verifyBundle(bundle);
    assert.equal(verified.source.chain, 'base');
    assert.equal(verified.source.txnId, HASH);

    const indexer = {
      lookupTransactionByID() {
        return {
          doRaw: async () =>
            Buffer.from(
              JSON.stringify({
                transaction: {
                  id: 'ATTEST',
                  note: Buffer.from(note, 'utf8').toString('base64'),
                  'confirmed-round': 10,
                  'genesis-id': 'mainnet-v1.0',
                },
              }),
            ),
        };
      },
    };
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      const result = body.method === 'eth_getTransactionByHash' ? transaction() : receipt();
      return Response.json({ jsonrpc: '2.0', id: 1, result });
    };
    const onChain = await verifyBundle(bundle, {
      chain: true,
      algorand: { client: { indexer } } as unknown as AlgorandClient,
      fetchImpl,
    });
    assert.equal(onChain.source.hashSha256, hashed.hashSha256);

    const loaded = await loadAttestationSource({
      algorand: { client: { indexer } } as unknown as AlgorandClient,
      txid: `0x${'AB'.repeat(32)}`,
      chain: 'base',
      fetchImpl,
    });
    assert.equal(loaded.txnId, HASH);
    assert.equal(loaded.hashed.hashSha256, hashed.hashSha256);
  });

  it('fetches a confirmed Base transaction over JSON-RPC', async () => {
    const fetchImpl: typeof fetch = async () => Response.json({ jsonrpc: '2.0', id: 1, result: null });
    await assert.rejects(
      () => fetchBaseTransaction(HASH, fetchImpl, { BASE_RPC_URL: 'https://base.example' }),
      /did not return transaction/,
    );
  });
});
