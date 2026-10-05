import { address, getAddressEncoder, type Address } from "@solana/addresses";
import type { ReadonlyUint8Array } from "@solana/codecs-core";
import type { SignatureBytes } from "@solana/keys";
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  setTransactionMessageComputeUnitPrice,
} from "@solana/transaction-messages";
import { compileTransaction, getTransactionDecoder } from "@solana/transactions";
import type { ClientSvmSigner } from "@x402/svm";

const SIGNATURE_LENGTH = 64;
const MEMO_PROGRAM_ADDRESS = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** Facilitators accept 3 to 6 instructions: limit, price, transfer, then wallet guards. */
const MIN_PAYMENT_INSTRUCTIONS = 3;

type SignedTransaction = {
  readonly messageBytes: ReadonlyUint8Array;
  readonly signatures?: Readonly<Record<string, Uint8Array | null>>;
};

type WalletSigner = {
  readonly address: string;
  signAllTransactions(transactions: readonly Uint8Array[]): Promise<readonly unknown[]>;
};

/**
 * Kit signer for an x402 Solana payment.
 *
 * The facilitator is the fee payer, so its signature occupies the first slot and
 * stays empty until settlement. On localhost, wallets leave the message alone and
 * still sign the payer's own slot. On a public site, Phantom and Solflare append
 * guard instructions, so the message changes. The rebuilt transaction has to keep
 * that empty fee-payer slot. Dropping it makes the signature count disagree with
 * the message, and the facilitator reports the transaction could not be decoded.
 * The client also adds a memo. Together with those guards the instruction count
 * exceeds the facilitator's limit, so the memo is removed before the wallet signs.
 */
export function createSolanaPaymentSigner(wallet: WalletSigner): ClientSvmSigner {
  const signerAddress = address(wallet.address);
  return {
    address: signerAddress,
    async modifyAndSignTransactions(transactions: readonly SignedTransaction[]) {
      const prepared = transactions.map((transaction) => preparePaymentTransaction(transaction));
      const wires = prepared.map((transaction) => wireFromMessage(transaction.messageBytes));
      const signed = await wallet.signAllTransactions(wires);
      if (signed.length !== transactions.length) {
        throw new Error("The wallet did not sign.");
      }
      return signed.map((item, index) => applyWalletSignature(prepared[index], signedWireBytes(item), signerAddress));
    },
  } as unknown as ClientSvmSigner;
}

/**
 * Drop the uniqueness memo from an x402 payment so wallet guard instructions fit
 * in the facilitator's instruction budget. A small random compute price keeps
 * the payment unique. Transactions that are not that payment shape are left alone.
 */
export function preparePaymentTransaction<T extends SignedTransaction>(transaction: T): T {
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const message = decompileTransactionMessage(compiled);
  const withoutMemo = message.instructions.filter(
    (instruction) => String(instruction.programAddress) !== MEMO_PROGRAM_ADDRESS,
  );
  if (withoutMemo.length < MIN_PAYMENT_INSTRUCTIONS || withoutMemo.length === message.instructions.length) {
    return transaction;
  }
  const microLamports = BigInt((crypto.getRandomValues(new Uint32Array(1))[0] % 10_000) + 1);
  const priced = setTransactionMessageComputeUnitPrice(microLamports, {
    ...message,
    instructions: withoutMemo,
  });
  const shortened = compileTransaction(priced);
  return {
    ...transaction,
    messageBytes: shortened.messageBytes as T["messageBytes"],
    signatures: shortened.signatures,
  };
}

export function applyWalletSignature<T extends SignedTransaction>(
  transaction: T,
  signedWire: Uint8Array,
  signerAddress: Address,
): T {
  const { message } = splitWire(signedWire);
  if (bytesEqual(message, transaction.messageBytes)) {
    const signature = signatureAt(signedWire, signerIndex(transaction.messageBytes, signerAddress));
    return {
      ...transaction,
      signatures: {
        ...transaction.signatures,
        [signerAddress]: signature,
      },
    };
  }

  let decoded: { messageBytes: Uint8Array; signatures: Readonly<Record<string, Uint8Array | null>> };
  try {
    decoded = getTransactionDecoder().decode(signedWire);
  } catch {
    throw new Error("The wallet did not sign.");
  }
  const payerSignature = decoded.signatures[signerAddress];
  if (!payerSignature || payerSignature.every((byte) => byte === 0)) {
    throw new Error("The wallet did not sign.");
  }
  const signatures: Record<string, SignatureBytes | null> = {};
  for (const account of Object.keys(decoded.signatures)) {
    signatures[account] = account === signerAddress ? payerSignature : null;
  }
  return {
    ...transaction,
    messageBytes: Uint8Array.from(decoded.messageBytes) as T["messageBytes"],
    signatures,
  };
}

function wireFromMessage(messageBytes: ReadonlyUint8Array): Uint8Array {
  const numSigners = messageHeader(messageBytes).numSigners;
  const count = encodeCompactU16(numSigners);
  const wire = new Uint8Array(count.length + numSigners * SIGNATURE_LENGTH + messageBytes.length);
  wire.set(count, 0);
  wire.set(messageBytes, count.length + numSigners * SIGNATURE_LENGTH);
  return wire;
}

function signerIndex(messageBytes: ReadonlyUint8Array, signerAddress: Address): number {
  const { numSigners, accountsOffset } = messageHeader(messageBytes);
  const wanted = getAddressEncoder().encode(signerAddress);
  for (let index = 0; index < numSigners; index += 1) {
    const start = accountsOffset + index * 32;
    if (bytesEqual(messageBytes.subarray(start, start + 32), wanted)) {
      return index;
    }
  }
  throw new Error("This wallet is not a signer on the Solana payment.");
}

function signatureAt(wire: ReadonlyUint8Array, index: number): SignatureBytes {
  const { numSignatures, signaturesOffset } = splitWire(wire);
  if (index < 0 || index >= numSignatures) {
    throw new Error("The wallet did not sign.");
  }
  const start = signaturesOffset + index * SIGNATURE_LENGTH;
  const signature = wire.slice(start, start + SIGNATURE_LENGTH);
  if (signature.length !== SIGNATURE_LENGTH || signature.every((byte) => byte === 0)) {
    throw new Error("The wallet did not sign.");
  }
  return signature as SignatureBytes;
}

function splitWire(wire: ReadonlyUint8Array): {
  numSignatures: number;
  signaturesOffset: number;
  message: ReadonlyUint8Array;
} {
  const { value: numSignatures, size } = decodeCompactU16(wire, 0);
  const signaturesOffset = size;
  const messageStart = size + numSignatures * SIGNATURE_LENGTH;
  if (numSignatures === 0 || messageStart > wire.length) {
    throw new Error("The wallet did not sign.");
  }
  return { numSignatures, signaturesOffset, message: wire.subarray(messageStart) };
}

function messageHeader(message: ReadonlyUint8Array): { numSigners: number; accountsOffset: number } {
  const offset = (message[0] & 0x80) === 0x80 ? 1 : 0;
  if (offset + 3 > message.length) {
    throw new Error("The wallet did not sign.");
  }
  const numSigners = message[offset];
  const accounts = decodeCompactU16(message, offset + 3);
  return { numSigners, accountsOffset: offset + 3 + accounts.size };
}

function encodeCompactU16(value: number): Uint8Array {
  if (value < 0x80) {
    return Uint8Array.of(value);
  }
  if (value < 0x4000) {
    return Uint8Array.of((value & 0x7f) | 0x80, value >> 7);
  }
  return Uint8Array.of((value & 0x7f) | 0x80, ((value >> 7) & 0x7f) | 0x80, value >> 14);
}

function decodeCompactU16(bytes: ReadonlyUint8Array, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  let shift = 0;
  while (size < 3) {
    const byte = bytes[offset + size];
    if (byte === undefined) {
      throw new Error("The wallet did not sign.");
    }
    value |= (byte & 0x7f) << shift;
    size += 1;
    if ((byte & 0x80) === 0) {
      return { value, size };
    }
    shift += 7;
  }
  throw new Error("The wallet did not sign.");
}

function signedWireBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value && typeof value === "object" && "serialize" in value && typeof value.serialize === "function") {
    const serialize = value.serialize as (config?: {
      requireAllSignatures?: boolean;
      verifySignatures?: boolean;
    }) => Uint8Array;
    try {
      return new Uint8Array(serialize({ requireAllSignatures: false, verifySignatures: false }));
    } catch {
      return new Uint8Array(serialize());
    }
  }
  throw new Error("The wallet did not sign.");
}

function bytesEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
