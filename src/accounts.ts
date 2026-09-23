import { randomBytes } from 'node:crypto';
import { generateKey, signCompressed } from 'falcon-1024';
import algosdk from 'algosdk';
import { addressOf } from './pq.ts';

/** Seed length for `ATTESTOR_FALCON_SEED`. Same 48 bytes produce the same Falcon key. */
export const FALCON_SEED_BYTES = 48;

export interface Ed25519Account {
  scheme: 'ed25519';
  address: string;
  mnemonic: string;
}

export interface FalconAccount {
  scheme: 'falcon-1024';
  algorandScheme: 'f1';
  address: string;
  salt: number;
  publicKeyBase64: string;
  seedHex: string;
}

export function generateEd25519Account(): Ed25519Account {
  const account = algosdk.generateAccount();
  return {
    scheme: 'ed25519',
    address: addressOf(account),
    mnemonic: algosdk.secretKeyToMnemonic(account.sk),
  };
}

export function generateFalconAccount(): FalconAccount {
  return falconAccountFromSeed(randomBytes(FALCON_SEED_BYTES));
}

export function falconAccountFromSeed(seed: Uint8Array): FalconAccount {
  if (seed.length !== FALCON_SEED_BYTES) {
    throw new Error(`Falcon seed must be ${FALCON_SEED_BYTES} bytes.`);
  }
  const { publicKey } = generateKey(seed);
  const derived = algosdk.addressFromPQKey(algosdk.FALCON_1024_SCHEME, publicKey);
  return {
    scheme: 'falcon-1024',
    algorandScheme: 'f1',
    address: derived.address.toString(),
    salt: derived.salt,
    publicKeyBase64: Buffer.from(publicKey).toString('base64'),
    seedHex: Buffer.from(seed).toString('hex'),
  };
}

/** 48-byte hex `seedHex` from `generate:pq`, stored in `ATTESTOR_FALCON_SEED`. */
export function falconSeedFromHex(hex: string | undefined): Uint8Array {
  const normalized = hex?.trim().replace(/^0x/, '') ?? '';
  if (!normalized) {
    throw new Error('ATTESTOR_FALCON_SEED is required.');
  }
  if (normalized.length !== FALCON_SEED_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`ATTESTOR_FALCON_SEED must be ${FALCON_SEED_BYTES} bytes of hex.`);
  }
  return Uint8Array.from(Buffer.from(normalized, 'hex'));
}

/**
 * On-chain signer for the attestation transaction.
 * Algorand verifies deterministic Falcon-1024 signatures in compressed form
 * (`falcon_det1024`). Randomized Falcon signatures are rejected.
 * The address is derived from the public key, and each signature is a `pqsig` with scheme `f1`.
 */
export function falconSigningAccount(seedHex: string | undefined) {
  const { publicKey, privateKey } = generateKey(falconSeedFromHex(seedHex));
  return algosdk.addressWithSignersFromRawFalcon1024Signer({
    falcon1024PublicKey: publicKey,
    falcon1024Signer: async (bytesToSign) => signCompressed(privateKey, bytesToSign),
  });
}
