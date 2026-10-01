import { blake2b } from "@noble/hashes/blake2.js";
import { sha256, sha512, sha512_256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToBase32, bytesToHex, concatBytes, reverseBytes, utf8 } from "./bytes.ts";

export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

export function doubleSha256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

export function keccak256(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

export function sha512_256Bytes(bytes: Uint8Array): Uint8Array {
  return sha512_256(bytes);
}

/** First 32 bytes of SHA-512. XRPL calls this SHA-512Half. */
export function sha512Half(bytes: Uint8Array): Uint8Array {
  return sha512(bytes).subarray(0, 32);
}

export function blake2b256(bytes: Uint8Array): Uint8Array {
  return blake2b(bytes, { dkLen: 32 });
}

export function evmHashHex(headerRlp: Uint8Array): string {
  return `0x${bytesToHex(keccak256(headerRlp))}`;
}

export function bitcoinHashHex(header: Uint8Array): string {
  return bytesToHex(reverseBytes(doubleSha256(header)));
}

/** Algorand block hash is base32(SHA-512/256("BH" || canonical header msgpack)). */
export function algorandBlockHash(headerMsgpack: Uint8Array): string {
  return bytesToBase32(sha512_256Bytes(concatBytes([utf8("BH"), headerMsgpack])));
}
