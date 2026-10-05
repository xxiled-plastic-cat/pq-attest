import { getBase64Encoder } from "@solana/codecs-strings";
import { AccountRole } from "@solana/instructions";
import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  decompileTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { applyWalletSignature, createSolanaPaymentSigner } from "./solana-payment-signer";

const BLOCKHASH = "48YdZUQ4CQuWNgNtShWj7nEfFx5D55UruizGUEd3tdyp";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

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
