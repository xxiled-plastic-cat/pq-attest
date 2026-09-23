import { createHash } from 'node:crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import algosdk from 'algosdk';
import type { Account } from 'algosdk';
import { canonicalJson } from './canonical.ts';
import type { ProofBundle, UnsignedBundle } from './types.ts';

const DOMAIN = 'pq-attest-mldsa65-v1';

export function addressOf(account: Account): string {
  return typeof account.addr === 'string' ? account.addr : account.addr.toString();
}

export function accountFromMnemonic(mnemonic: string | undefined): Account {
  if (!mnemonic || !mnemonic.trim()) {
    throw new Error('ATTESTOR_MNEMONIC is required.');
  }
  return algosdk.mnemonicToSecretKey(mnemonic.trim());
}

/**
 * ML-DSA-65 keypair for the proof bundle.
 * ATTESTOR_PQ_SEED (32-byte hex) overrides derivation from the mnemonic.
 * Otherwise the seed is SHA-256(domain || ed25519 seed), not the raw mnemonic seed.
 */
export function pqKeyPair(mnemonic: string): ReturnType<typeof ml_dsa65.keygen> {
  const override = process.env.ATTESTOR_PQ_SEED;
  const seed = override
    ? seedFromHex(override)
    : createHash('sha256')
        .update(DOMAIN)
        .update(algosdk.seedFromMnemonic(mnemonic.trim()))
        .digest();
  return ml_dsa65.keygen(seed);
}

function seedFromHex(hex: string): Buffer {
  const normalized = hex.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('ATTESTOR_PQ_SEED must be 32 bytes of hex.');
  }
  return Buffer.from(normalized, 'hex');
}

export function unsignedBundle(bundle: UnsignedBundle): UnsignedBundle {
  return {
    version: bundle.version,
    network: bundle.network,
    source: bundle.source,
    attest: bundle.attest,
    attestor: bundle.attestor,
  };
}

export function signBundle(bundle: UnsignedBundle, secretKey: Uint8Array): string {
  const message = Buffer.from(canonicalJson(unsignedBundle(bundle)), 'utf8');
  const signature = ml_dsa65.sign(message, secretKey);
  return Buffer.from(signature).toString('base64');
}

export function verifyBundleSignature(bundle: ProofBundle): boolean {
  const message = Buffer.from(canonicalJson(unsignedBundle(bundle)), 'utf8');
  const signature = Buffer.from(bundle.signature.sigBase64, 'base64');
  const publicKey = Buffer.from(bundle.attestor.pqPublicKey, 'base64');
  return ml_dsa65.verify(signature, message, publicKey);
}
