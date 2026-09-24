import { microAlgo } from '@algorandfoundation/algokit-utils';
import type { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { fetchBaseTransaction, hashBaseDocument } from './base.ts';
import { canonicalJson, hashTransaction, sha256Hex } from './canonical.ts';
import {
  NETWORK,
  fetchIndexerTransaction,
  fetchIndexerTransactionWithRetry,
} from './client.ts';
import type { SourceChain } from './source.ts';
import {
  accountFromMnemonic,
  pqKeyPair,
  signBundle,
  unsignedBundle,
  verifyBundleSignature,
} from './pq.ts';
import type { IndexerTransaction, ProofBundle, UnsignedBundle } from './types.ts';

const NOTE_MAX_BYTES = 1024;
/** Consensus minimum fee for a Falcon-1024 (`f1`) signature. */
const FALCON_MIN_FEE_MICROALGO = 3000;

export function attestNote(sourceTxId: string, hashSha256: string): string {
  const note = `attest:v1:${sourceTxId}:${hashSha256}`;
  if (Buffer.byteLength(note, 'utf8') > NOTE_MAX_BYTES) {
    throw new Error(`Attest note is ${Buffer.byteLength(note, 'utf8')} bytes; the maximum is ${NOTE_MAX_BYTES}.`);
  }
  return note;
}

export function noteText(transaction: { note?: unknown }): string {
  const note = transaction.note;
  if (note == null || note === '') {
    return '';
  }
  if (typeof note === 'string') {
    return Buffer.from(note, 'base64').toString('utf8');
  }
  return Buffer.from(note as Uint8Array).toString('utf8');
}

/**
 * Fetch the confirmed source transaction, post a 0 ALGO self-transaction whose
 * note commits to its hash, and return an ML-DSA-65 signed proof bundle.
 * This is not an x402 payment.
 *
 * The 0 ALGO transaction is authorized by the Falcon-1024 account in
 * `ATTESTOR_FALCON_SEED` (scheme `f1`, 3000 microAlgo minimum fee). The ML-DSA-65
 * key signs only the proof bundle.
 */
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function loadAttestationSource({
  algorand,
  txid,
  chain = 'algorand',
  fetchImpl,
}: {
  algorand: AlgorandClient;
  txid: string;
  chain?: SourceChain;
  fetchImpl?: FetchLike;
}): Promise<{ chain: SourceChain; txnId: string; hashed: ReturnType<typeof hashTransaction> }> {
  if (chain === 'base') {
    const document = await fetchBaseTransaction(txid, fetchImpl);
    return { chain, txnId: document.hash, hashed: hashBaseDocument(document) };
  }
  const sourceTxn = await fetchIndexerTransaction(algorand.client.indexer, txid);
  return { chain: 'algorand', txnId: txid, hashed: hashTransaction(sourceTxn) };
}

export async function attestTransaction({
  algorand,
  txid,
  chain = 'algorand',
  mnemonic,
  falconSeed,
  fetchImpl,
}: {
  algorand: AlgorandClient;
  txid: string;
  chain?: SourceChain;
  mnemonic: string | undefined;
  falconSeed: string | undefined;
  fetchImpl?: FetchLike;
}): Promise<ProofBundle> {
  const trimmedMnemonic = mnemonic?.trim() ?? '';
  accountFromMnemonic(trimmedMnemonic);
  const { falconSigningAccount } = await import('./accounts.ts');
  const falcon = falconSigningAccount(falconSeed);
  const sender = falcon.address.toString();
  const source = await loadAttestationSource({ algorand, txid, chain, fetchImpl });
  const hashed = source.hashed;
  const note = attestNote(source.txnId, hashed.hashSha256);

  algorand.setSigner(sender, falcon.txnSigner);
  const result = await algorand.send.payment({
    sender,
    receiver: sender,
    amount: microAlgo(0),
    note,
    staticFee: microAlgo(FALCON_MIN_FEE_MICROALGO),
    suppressLog: true,
  });

  const attestTxId = result.txIds[0];
  if (!attestTxId) {
    throw new Error('Attest transaction was not submitted.');
  }
  const round = confirmedRound(result.confirmation);
  const keys = pqKeyPair(trimmedMnemonic);
  const unsigned: UnsignedBundle = {
    version: 1,
    network: NETWORK,
    source: {
      ...(source.chain === 'base' ? { chain: 'base' as const } : {}),
      txnId: source.txnId,
      hashSha256: hashed.hashSha256,
      txnBytesBase64: hashed.txnBytesBase64,
    },
    attest: {
      txnId: attestTxId,
      round,
      note,
    },
    attestor: {
      algorandAddress: sender,
      pqPublicKey: Buffer.from(keys.publicKey).toString('base64'),
    },
  };

  return {
    ...unsigned,
    signature: {
      alg: 'ML-DSA-65',
      sigBase64: signBundle(unsigned, keys.secretKey),
    },
  };
}

function confirmedRound(confirmation: { confirmedRound?: number | bigint } | undefined): number {
  const round = confirmation?.confirmedRound;
  if (round == null) {
    throw new Error('Attest transaction was not confirmed.');
  }
  const asNumber = Number(round);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`Confirmed round ${String(round)} is not a safe integer.`);
  }
  return asNumber;
}

export async function verifyBundle(
  bundle: unknown,
  {
    chain = false,
    algorand,
    fetchImpl,
  }: { chain?: boolean; algorand?: AlgorandClient; fetchImpl?: FetchLike } = {},
): Promise<UnsignedBundle> {
  assertShape(bundle);
  if (bundle.network !== NETWORK) {
    throw new Error(`Bundle network must be ${NETWORK}.`);
  }
  if (!verifyBundleSignature(bundle)) {
    throw new Error('ML-DSA-65 signature rejected.');
  }

  const preimage = Buffer.from(bundle.source.txnBytesBase64, 'base64');
  if (sha256Hex(preimage) !== bundle.source.hashSha256) {
    throw new Error('source.hashSha256 does not match a re-hash of txnBytesBase64.');
  }
  const parsedPreimage: unknown = JSON.parse(preimage.toString('utf8'));
  if (canonicalJson(parsedPreimage) !== preimage.toString('utf8')) {
    throw new Error('txnBytesBase64 is not canonical JSON of the source transaction.');
  }
  const sourceChain = sourceChainOf(bundle.source.chain);
  if (!sourceDocumentMatches(sourceChain, parsedPreimage, bundle.source.txnId)) {
    throw new Error('Canonical source document id does not match source.txnId.');
  }

  const expectedNote = attestNote(bundle.source.txnId, bundle.source.hashSha256);
  if (bundle.attest.note !== expectedNote) {
    throw new Error('attest.note does not match the v1 recipe for this source transaction.');
  }

  if (chain) {
    if (!algorand) {
      throw new Error('A MainNet client is required to re-fetch transactions.');
    }
    const recomputed =
      sourceChain === 'base'
        ? hashBaseDocument(await fetchBaseTransaction(bundle.source.txnId, fetchImpl))
        : hashTransaction(await fetchIndexerTransaction(algorand.client.indexer, bundle.source.txnId));
    if (recomputed.hashSha256 !== bundle.source.hashSha256) {
      throw new Error('Re-fetched source transaction hash does not match source.hashSha256.');
    }
    if (recomputed.canonical !== preimage.toString('utf8')) {
      throw new Error('Re-fetched source transaction bytes do not match txnBytesBase64.');
    }

    const attestTxn = await fetchIndexerTransactionWithRetry(
      algorand.client.indexer,
      bundle.attest.txnId,
      8,
    );
    if (noteText(attestTxn) !== bundle.attest.note) {
      throw new Error('On-chain attest note does not match the bundle.');
    }
    if (Number(attestTxn['confirmed-round']) !== bundle.attest.round) {
      throw new Error('On-chain attest round does not match the bundle.');
    }
  }

  return unsignedBundle(bundle);
}

function sourceChainOf(chain: unknown): SourceChain {
  if (chain == null) {
    return 'algorand';
  }
  if (chain === 'base' || chain === 'algorand') {
    return chain;
  }
  throw new Error('source.chain must be base or algorand.');
}

function sourceDocumentMatches(chain: SourceChain, document: unknown, txnId: string): boolean {
  if (!document || typeof document !== 'object') {
    return false;
  }
  if (chain === 'base') {
    return (document as { hash?: unknown }).hash === txnId;
  }
  return isSourceDocument(document) && document.id === txnId;
}

function isSourceDocument(value: unknown): value is IndexerTransaction {
  return Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';
}

function assertShape(bundle: unknown): asserts bundle is ProofBundle {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Bundle must be a JSON object.');
  }
  const candidate = bundle as Partial<ProofBundle>;
  if (candidate.version !== 1) {
    throw new Error('Bundle version must be 1.');
  }
  if (candidate.signature?.alg !== 'ML-DSA-65' || typeof candidate.signature.sigBase64 !== 'string') {
    throw new Error('Bundle signature must be ML-DSA-65.');
  }
  for (const key of ['txnId', 'hashSha256', 'txnBytesBase64'] as const) {
    if (typeof candidate.source?.[key] !== 'string' || candidate.source[key] === '') {
      throw new Error(`Bundle source.${key} is required.`);
    }
  }
  if (!candidate.source || !/^[0-9a-f]{64}$/.test(candidate.source.hashSha256)) {
    throw new Error('source.hashSha256 must be 64 lowercase hex characters.');
  }
  if (typeof candidate.attest?.txnId !== 'string' || typeof candidate.attest.note !== 'string') {
    throw new Error('Bundle attest.txnId and attest.note are required.');
  }
  if (!Number.isSafeInteger(candidate.attest.round)) {
    throw new Error('Bundle attest.round must be an integer.');
  }
  if (typeof candidate.attestor?.algorandAddress !== 'string' || typeof candidate.attestor.pqPublicKey !== 'string') {
    throw new Error('Bundle attestor.algorandAddress and attestor.pqPublicKey are required.');
  }
  if (candidate.network !== 'algorand-mainnet') {
    throw new Error('Bundle network must be algorand-mainnet.');
  }
  if (
    candidate.source?.chain != null &&
    candidate.source.chain !== 'base' &&
    candidate.source.chain !== 'algorand'
  ) {
    throw new Error('source.chain must be base or algorand.');
  }
  if (candidate.source?.chain === 'base' && !/^0x[0-9a-f]{64}$/.test(candidate.source.txnId)) {
    throw new Error('Base source.txnId must be a lowercase 0x transaction hash.');
  }
}
