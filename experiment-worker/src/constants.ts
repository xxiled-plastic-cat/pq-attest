/** Published Falcon attestor. Notes from any other account are ignored. */
export const ATTESTOR_ADDRESS = "EVG4CYNYGIDNDIDJTUDJU7ELJQJBNAJA6UZAQJO54XCL5SKKM6IR33PQJE";

export const EXPERIMENT_ID = "bitcoin-blocks-24h";

/** Durable Object name. A new epoch starts an empty run and leaves the previous one unused. */
export function experimentObjectName(epoch: string | undefined): string {
  const trimmed = epoch?.trim() ?? "";
  return trimmed.length > 0 ? `${EXPERIMENT_ID}:${trimmed}` : EXPERIMENT_ID;
}
export const CONFIRMATIONS = 2;
export const WINDOW_MS = 24 * 60 * 60 * 1000;
/** 0.001 USDC. A higher advertised price refuses the tick. */
export const MAX_ATOMIC_USDC = 1000n;

export function blockNotePrefix(height: number): string {
  return `block-attest:v1:bitcoin:${height}:`;
}
