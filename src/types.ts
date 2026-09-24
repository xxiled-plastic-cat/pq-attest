export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface IndexerTransaction {
  id: string;
  note?: string;
  'genesis-id'?: string;
  'confirmed-round'?: number;
  [key: string]: JsonValue | undefined;
}

export interface SourceRef {
  /** Present for a Base source. Omitted Algorand bundles stay valid. */
  chain?: "base" | "algorand";
  txnId: string;
  hashSha256: string;
  txnBytesBase64: string;
}

export interface AttestRef {
  txnId: string;
  round: number;
  note: string;
}

export interface Attestor {
  algorandAddress: string;
  pqPublicKey: string;
}

export interface UnsignedBundle {
  version: 1;
  network: 'algorand-mainnet';
  source: SourceRef;
  attest: AttestRef;
  attestor: Attestor;
}

export interface ProofBundle extends UnsignedBundle {
  signature: {
    alg: 'ML-DSA-65';
    sigBase64: string;
  };
}
