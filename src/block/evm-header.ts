import { hexToBytes } from "./bytes.ts";
import { evmHashHex } from "./hash.ts";
import { rlpEncode, type RlpItem, uintToBytes } from "./rlp.ts";

export type EvmHeaderStyle = "standard" | "arbitrum" | "avalanche";

/**
 * Keccak-256 of the RLP header. Fork fields are included only when the node
 * returns them: London base fee, Shanghai withdrawals root, Cancun blob
 * fields, Prague requests hash. Arbitrum Nitro appends sendCount and sendRoot
 * when those RPC fields are present.
 */
export function encodeEvmHeader(block: Record<string, unknown>, style: EvmHeaderStyle = "standard"): Uint8Array {
  const fields: RlpItem[] = [
    word(block.parentHash, 32),
    word(block.sha3Uncles, 32),
    word(block.miner, 20),
    word(block.stateRoot, 32),
    word(block.transactionsRoot, 32),
    word(block.receiptsRoot, 32),
    word(block.logsBloom, 256),
    quantity(block.difficulty),
    quantity(block.number),
    quantity(block.gasLimit),
    quantity(block.gasUsed),
    quantity(block.timestamp),
    bytesField(block.extraData),
    word(block.mixHash, 32),
    word(block.nonce, 8),
  ];
  if (block.baseFeePerGas != null) {
    fields.push(quantity(block.baseFeePerGas));
  }
  if (block.withdrawalsRoot != null) {
    fields.push(word(block.withdrawalsRoot, 32));
  }
  if (block.blobGasUsed != null) {
    fields.push(quantity(block.blobGasUsed));
    fields.push(quantity(block.excessBlobGas));
    fields.push(word(block.parentBeaconBlockRoot, 32));
  }
  if (block.requestsHash != null) {
    fields.push(word(block.requestsHash, 32));
  }
  if (style === "arbitrum" && block.sendCount != null && block.sendRoot != null) {
    fields.push(quantity(block.sendCount));
    fields.push(word(block.sendRoot, 32));
  }
  if (style === "avalanche") {
    return rlpEncode(avalancheFields(block));
  }
  return rlpEncode(fields);
}

export function evmHeaderHash(block: Record<string, unknown>, style: EvmHeaderStyle = "standard"): string {
  return evmHashHex(encodeEvmHeader(block, style));
}

function avalancheFields(block: Record<string, unknown>): RlpItem[] {
  const fields: RlpItem[] = [
    word(block.parentHash, 32),
    word(block.sha3Uncles, 32),
    word(block.miner, 20),
    word(block.stateRoot, 32),
    word(block.transactionsRoot, 32),
    word(block.receiptsRoot, 32),
    word(block.logsBloom, 256),
    quantity(block.difficulty),
    quantity(block.number),
    quantity(block.gasLimit),
    quantity(block.gasUsed),
    quantity(block.timestamp),
    bytesField(block.extraData),
    word(block.mixHash, 32),
    word(block.nonce, 8),
    word(block.extDataHash, 32),
  ];
  const optionalNames = [
    "baseFeePerGas",
    "extDataGasUsed",
    "blockGasCost",
    "blobGasUsed",
    "excessBlobGas",
    "parentBeaconBlockRoot",
    "timestampMilliseconds",
    "minDelayExcess",
  ] as const;
  let last = -1;
  optionalNames.forEach((name, index) => {
    if (block[name] != null) {
      last = index;
    }
  });
  for (let index = 0; index <= last; index += 1) {
    const name = optionalNames[index]!;
    if (block[name] == null) {
      fields.push(new Uint8Array());
    } else if (name === "parentBeaconBlockRoot") {
      fields.push(word(block[name], 32));
    } else {
      fields.push(quantity(block[name]));
    }
  }
  return fields;
}

function word(value: unknown, size: number): Uint8Array {
  const bytes = hexToBytes(requiredHex(value));
  if (bytes.length > size) {
    throw new Error(`Header field is ${bytes.length} bytes; expected at most ${size}.`);
  }
  if (bytes.length === size) {
    return bytes;
  }
  const padded = new Uint8Array(size);
  padded.set(bytes, size - bytes.length);
  return padded;
}

function bytesField(value: unknown): Uint8Array {
  if (value == null || value === "0x") {
    return new Uint8Array();
  }
  return hexToBytes(requiredHex(value));
}

function quantity(value: unknown): Uint8Array {
  if (typeof value !== "string") {
    throw new Error("Header quantity is missing.");
  }
  return uintToBytes(BigInt(value));
}

function requiredHex(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw new Error("Header field is not hex.");
  }
  return value;
}
