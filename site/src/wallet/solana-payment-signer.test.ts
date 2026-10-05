import { getBase64Encoder } from "@solana/codecs-strings";
import { getSetComputeUnitLimitInstruction, setTransactionMessageComputeUnitPrice } from "@solana-program/compute-budget";
import { AccountRole } from "@solana/instructions";
import {
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  decompileTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  pipe,
  prependTransactionMessageInstruction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { applyWalletSignature, createSolanaPaymentSigner, preparePaymentTransaction } from "./solana-payment-signer";

const BLOCKHASH = "48YdZUQ4CQuWNgNtShWj7nEfFx5D55UruizGUEd3tdyp";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

describe("preparePaymentTransaction", () => {
  it("drops the memo so two wallet guard instructions stay within the facilitator limit", async () => {
    const feePayer = await generateKeyPairSigner();
    const user = await generateKeyPairSigner();
    const transaction = x402Payment(feePayer.address, user);
    const prepared = preparePaymentTransaction(transaction);
    const programs = instructionPrograms(prepared.messageBytes);

    expect(programs).toEqual([COMPUTE_BUDGET, COMPUTE_BUDGET, TOKEN]);
    const price = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(prepared.messageBytes))
      .instructions[1]?.data;
    expect(price?.[0]).toBe(3);
    const microLamports = new DataView(price!.buffer, price!.byteOffset + 1, 8).getBigUint64(0, true);
    expect(microLamports).toBeGreaterThan(0n);
    expect(microLamports).toBeLessThanOrEqual(10_000n);
  });

  it("leaves a non-payment transaction unchanged", async () => {
    const feePayer = await generateKeyPairSigner();
    const user = await generateKeyPairSigner();
    const transaction = paymentTransaction(feePayer.address, user);
    expect(preparePaymentTransaction(transaction).messageBytes).toEqual(transaction.messageBytes);
  });
});

describe("createSolanaPaymentSigner", () => {
  it("keeps the payer signature when the fee payer slot is still empty", async () => {
    const feePayer = await generateKeyPairSigner();
    const user = await generateKeyPairSigner();
    const transaction = paymentTransaction(feePayer.address, user);
    const payerSignature = Uint8Array.from({ length: 64 }, () => 0xcd);
    const signer = createSolanaPaymentSigner({
      address: user.address,
      async signAllTransactions(transactions) {
        return transactions.map((wire) => {
          const signed = new Uint8Array(wire);
          signed.fill(0xab, 1, 65);
          signed.set(payerSignature, 65);
          return signed;
        });
      },
    });

    if (!("modifyAndSignTransactions" in signer)) {
      throw new Error("expected a modifying signer");
    }
    const [signed] = await signer.modifyAndSignTransactions([transaction]);
    expect(Array.from(signed.signatures[user.address] ?? [])).toEqual(Array.from(payerSignature));
    expect(signed.messageBytes).toEqual(transaction.messageBytes);
  });

  it("rejects an empty payer signature", async () => {
    const feePayer = await generateKeyPairSigner();
    const user = await generateKeyPairSigner();
    const transaction = paymentTransaction(feePayer.address, user);
    expect(() => applyWalletSignature(transaction, wireWithEmptyPayer(transaction.messageBytes), user.address)).toThrow(
      /did not sign/,
    );
  });

  it("keeps a wallet-rewritten message the facilitator can decode", async () => {
    const feePayer = await generateKeyPairSigner();
    const user = await generateKeyPairSigner();
    const transaction = paymentTransaction(feePayer.address, user);
    const rewritten = paymentTransaction(feePayer.address, user, new Uint8Array([9, 9, 9, 9]));
    const wire = wireWithEmptyPayer(rewritten.messageBytes);
    const payerSignature = Uint8Array.from({ length: 64 }, () => 0x11);
    wire.set(payerSignature, 65);

    const signed = applyWalletSignature(transaction, wire, user.address);
    expect(Array.from(signed.messageBytes)).toEqual(Array.from(rewritten.messageBytes));
    expect(Array.from(signed.signatures?.[user.address] ?? [])).toEqual(Array.from(payerSignature));
    expect(signed.signatures?.[feePayer.address] ?? null).toBeNull();

    const encoded = getBase64EncodedWireTransaction(signed);
    const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(encoded));
    expect(Object.keys(decoded.signatures)).toEqual([feePayer.address, user.address]);
    expect(decoded.signatures[feePayer.address]).toBeNull();
    const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
    expect(decompileTransactionMessage(compiled).instructions.length).toBeGreaterThan(0);
  });
});

function instructionPrograms(messageBytes: Uint8Array): string[] {
  return decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(messageBytes)).instructions.map(
    (instruction) => String(instruction.programAddress),
  );
}

function x402Payment(feePayer: string, user: Awaited<ReturnType<typeof generateKeyPairSigner>>) {
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageComputeUnitPrice(1n, tx),
      (tx) => setTransactionMessageFeePayer(feePayer as never, tx),
      (tx) => prependTransactionMessageInstruction(getSetComputeUnitLimitInstruction({ units: 20_000 }), tx),
      (tx) =>
        appendTransactionMessageInstructions(
          [
            {
              programAddress: TOKEN as never,
              accounts: [{ address: user.address, role: AccountRole.READONLY_SIGNER }],
              data: new Uint8Array([12, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
            },
            {
              programAddress: MEMO as never,
              accounts: [],
              data: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
            },
          ],
          tx,
        ),
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: BLOCKHASH as never, lastValidBlockHeight: 1n },
          tx,
        ),
    ),
  );
}

function paymentTransaction(
  feePayer: string,
  user: Awaited<ReturnType<typeof generateKeyPairSigner>>,
  data = new Uint8Array([1, 2, 3]),
) {
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(feePayer as never, tx),
      (tx) =>
        appendTransactionMessageInstruction(
          {
            programAddress: MEMO as never,
            accounts: [{ address: user.address, role: AccountRole.READONLY_SIGNER, signer: user }],
            data,
          },
          tx,
        ),
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: BLOCKHASH as never, lastValidBlockHeight: 1n },
          tx,
        ),
    ),
  );
}

function wireWithEmptyPayer(messageBytes: ArrayLike<number> & { readonly length: number }): Uint8Array {
  const wire = new Uint8Array(1 + 128 + messageBytes.length);
  wire[0] = 2;
  wire.set(messageBytes, 129);
  return wire;
}
