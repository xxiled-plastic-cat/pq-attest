import { concatBytes } from "./bytes.ts";

export type RlpItem = Uint8Array | RlpItem[] | number | bigint;

export function rlpEncode(item: RlpItem): Uint8Array {
  if (typeof item === "number" || typeof item === "bigint") {
    return encodeBytes(uintToBytes(item));
  }
  if (item instanceof Uint8Array) {
    return encodeBytes(item);
  }
  const encoded = item.map((child) => rlpEncode(child));
  return encodeLength(concatBytes(encoded), 0xc0);
}

function encodeBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && bytes[0]! < 0x80) {
    return bytes;
  }
  return encodeLength(bytes, 0x80);
}

function encodeLength(payload: Uint8Array, offset: number): Uint8Array {
  if (payload.length < 56) {
    const out = new Uint8Array(1 + payload.length);
    out[0] = offset + payload.length;
    out.set(payload, 1);
    return out;
  }
  const lengthBytes = uintToBytes(payload.length);
  const out = new Uint8Array(1 + lengthBytes.length + payload.length);
  out[0] = offset + 55 + lengthBytes.length;
  out.set(lengthBytes, 1);
  out.set(payload, 1 + lengthBytes.length);
  return out;
}

export function uintToBytes(value: number | bigint): Uint8Array {
  let current = typeof value === "bigint" ? value : BigInt(value);
  if (current < 0n) {
    throw new Error("RLP integers must be non-negative.");
  }
  if (current === 0n) {
    return new Uint8Array();
  }
  const bytes: number[] = [];
  while (current > 0n) {
    bytes.push(Number(current & 0xffn));
    current >>= 8n;
  }
  bytes.reverse();
  return new Uint8Array(bytes);
}

export interface DecodedRlp {
  item: Uint8Array | DecodedRlp[];
  rest: Uint8Array;
}

export function rlpDecode(bytes: Uint8Array): DecodedRlp {
  if (bytes.length === 0) {
    throw new Error("RLP input is empty.");
  }
  const prefix = bytes[0]!;
  if (prefix <= 0x7f) {
    return { item: bytes.subarray(0, 1), rest: bytes.subarray(1) };
  }
  if (prefix <= 0xb7) {
    const length = prefix - 0x80;
    return takeBytes(bytes, 1, length);
  }
  if (prefix <= 0xbf) {
    const lengthOfLength = prefix - 0xb7;
    const length = readLength(bytes.subarray(1, 1 + lengthOfLength));
    return takeBytes(bytes, 1 + lengthOfLength, length);
  }
  if (prefix <= 0xf7) {
    const length = prefix - 0xc0;
    return takeList(bytes, 1, length);
  }
  const lengthOfLength = prefix - 0xf7;
  const length = readLength(bytes.subarray(1, 1 + lengthOfLength));
  return takeList(bytes, 1 + lengthOfLength, length);
}

function takeBytes(bytes: Uint8Array, offset: number, length: number): DecodedRlp {
  const end = offset + length;
  if (end > bytes.length) {
    throw new Error("RLP string overruns the input.");
  }
  return { item: bytes.subarray(offset, end), rest: bytes.subarray(end) };
}

function takeList(bytes: Uint8Array, offset: number, length: number): DecodedRlp {
  const end = offset + length;
  if (end > bytes.length) {
    throw new Error("RLP list overruns the input.");
  }
  const items: DecodedRlp[] = [];
  let rest = bytes.subarray(offset, end);
  while (rest.length > 0) {
    const decoded = rlpDecode(rest);
    items.push(decoded);
    rest = decoded.rest;
  }
  return { item: items, rest: bytes.subarray(end) };
}

function readLength(bytes: Uint8Array): number {
  if (bytes.length === 0 || bytes[0] === 0) {
    throw new Error("RLP length is not canonical.");
  }
  let length = 0;
  for (const byte of bytes) {
    length = length * 256 + byte;
  }
  return length;
}

export function rlpBytes(item: DecodedRlp["item"]): Uint8Array {
  if (item instanceof Uint8Array) {
    return item;
  }
  throw new Error("Expected an RLP byte string.");
}
