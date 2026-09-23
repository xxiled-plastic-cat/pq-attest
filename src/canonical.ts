import { createHash } from 'node:crypto';
import type { JsonValue } from './types.ts';

/**
 * Compact JSON with object keys sorted at every level. Array order is preserved.
 * This is the byte format both the source hash and the ML-DSA message use.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === 'object') {
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        sorted[key] = sortValue(child);
      }
    }
    return sorted;
  }
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Hash the full confirmed transaction document returned by indexer.
 * Every field is kept; nothing is selected out of the object.
 */
export function hashTransaction(transaction: unknown): {
  canonical: string;
  txnBytes: Buffer;
  hashSha256: string;
  txnBytesBase64: string;
} {
  const canonical = canonicalJson(transaction);
  const txnBytes = Buffer.from(canonical, 'utf8');
  return {
    canonical,
    txnBytes,
    hashSha256: sha256Hex(txnBytes),
    txnBytesBase64: txnBytes.toString('base64'),
  };
}
