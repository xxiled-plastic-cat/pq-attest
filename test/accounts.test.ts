import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import algosdk from 'algosdk';
import {
  FALCON_DET1024_PUBKEY_SIZE,
  FALCON_DET1024_SIG_COMPRESSED_MAXSIZE,
  verifyCompressed,
} from 'falcon-1024';
import {
  FALCON_SEED_BYTES,
  falconAccountFromSeed,
  falconSeedFromHex,
  falconSigningAccount,
  generateEd25519Account,
  generateFalconAccount,
} from '../src/accounts.ts';
import { addressOf } from '../src/pq.ts';

describe('ed25519 accounts', () => {
  it('returns a mnemonic that restores the same address', () => {
    const generated = generateEd25519Account();
    const restored = algosdk.mnemonicToSecretKey(generated.mnemonic);
    assert.equal(addressOf(restored), generated.address);
    assert.equal(generated.scheme, 'ed25519');
    assert.notEqual(generateEd25519Account().address, generated.address);
  });
});

describe('Falcon-1024 accounts', () => {
  it('derives a stable Algorand address from the seed', () => {
    const generated = generateFalconAccount();
    const restored = falconAccountFromSeed(Buffer.from(generated.seedHex, 'hex'));
    assert.equal(restored.address, generated.address);
    assert.equal(restored.publicKeyBase64, generated.publicKeyBase64);
    assert.equal(restored.salt, generated.salt);
    assert.equal(generated.scheme, 'falcon-1024');
    assert.equal(generated.algorandScheme, 'f1');
    assert.equal(Buffer.from(generated.publicKeyBase64, 'base64').length, FALCON_DET1024_PUBKEY_SIZE);
    assert.equal(generated.seedHex.length, FALCON_SEED_BYTES * 2);
  });

  it('rejects a missing or short Falcon seed', () => {
    assert.throws(() => falconSeedFromHex(undefined), /ATTESTOR_FALCON_SEED is required/);
    assert.throws(() => falconSeedFromHex('abcd'), /48 bytes of hex/);
  });

  it('signs a payment with a Falcon-1024 pqsig', async () => {
    const generated = generateFalconAccount();
    const signer = falconSigningAccount(generated.seedHex);
    assert.equal(signer.address.toString(), generated.address);

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: generated.address,
      receiver: generated.address,
      amount: 0,
      note: new TextEncoder().encode('attest'),
      suggestedParams: {
        flatFee: true,
        fee: 3000,
        minFee: 3000,
        firstValid: 1,
        lastValid: 1001,
        genesisID: 'mainnet-v1.0',
        genesisHash: new Uint8Array(32).fill(7),
      },
    });
    const [encoded] = await signer.txnSigner([txn], [0]);
    const decoded = algosdk.decodeSignedTransaction(encoded);
    assert.ok(decoded.pqsig);
    assert.equal(Buffer.from(decoded.pqsig.sch).toString('utf8'), 'f1');
    assert.equal(Buffer.from(decoded.pqsig.pk).toString('base64'), generated.publicKeyBase64);
    assert.equal(decoded.sig, undefined);
    assert.ok(decoded.pqsig.sig.length <= FALCON_DET1024_SIG_COMPRESSED_MAXSIZE);
    assert.equal(
      verifyCompressed(
        Buffer.from(generated.publicKeyBase64, 'base64'),
        decoded.pqsig.sig,
        txn.bytesToSign(),
      ),
      true,
    );
  });
});
