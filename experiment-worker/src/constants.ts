/** Published Falcon attestor. Notes from any other account are ignored. */
export const ATTESTOR_ADDRESS = "EVG4CYNYGIDNDIDJTUDJU7ELJQJBNAJA6UZAQJO54XCL5SKKM6IR33PQJE";

export const EXPERIMENT_ID = "bitcoin-blocks-24h";
export const ETHEREUM_EXPERIMENT_ID = "ethereum-blocks-6h";

export type ExperimentChain = "bitcoin" | "ethereum";

/** Durable Object name. A new epoch starts an empty run and leaves the previous one unused. */
export function experimentObjectName(epoch: string | undefined, id: string = EXPERIMENT_ID): string {
  const trimmed = epoch?.trim() ?? "";
  return trimmed.length > 0 ? `${id}:${trimmed}` : id;
}

/** Default lag for block experiments. A block is attested only once it is this far behind the tip. */
export const CONFIRMATIONS = 2;
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const ETHEREUM_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Heights one Ethereum alarm will pay before it reschedules. */
export const ETHEREUM_BURST = 10;
/** Paid blocks in the Ethereum test run. Three bursts of ETHEREUM_BURST. */
export const ETHEREUM_TEST_BLOCKS = 30;
/** How long to wait when the next height is not confirmed yet. */
export const ETHEREUM_POLL_MS = 12_000;
/** 0.001 USDC. A higher advertised price refuses the tick. */
export const MAX_ATOMIC_USDC = 1000n;

export function blockNotePrefix(height: number, chain: ExperimentChain = "bitcoin"): string {
  return `block-attest:v1:${chain}:${height}:`;
}
