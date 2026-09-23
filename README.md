# pq-attest

CLI proof of concept, written in TypeScript, for attesting a confirmed Algorand MainNet transaction. It fetches the transaction, SHA-256s the full indexer document, submits a 0 ALGO transaction whose note commits to that hash, and prints a proof bundle signed with ML-DSA-65.

There is no x402 payment, no HTTP server, and no state proof in the bundle. The 0 ALGO transaction only carries the attestation note. It is authorized with a Falcon-1024 account (`f1`). The ML-DSA-65 signature is over the proof bundle, not the Algorand transaction.

## Setup

Node.js 22 or newer.

```bash
npm install
cp .env.example .env
```

Put the Falcon `seedHex` from `npm run generate:pq` in `ATTESTOR_FALCON_SEED`, and fund that printed address on MainNet. The account must hold more than the 0.1 ALGO minimum balance, because the Falcon signature fee is 3000 microAlgo.

`ATTESTOR_MNEMONIC` is still required. It is the ed25519 mnemonic the ML-DSA-65 proof key is derived from. It does not send the attestation transaction.

Public AlgoNode MainNet is the default when those variables are unset:

- `ALGOD_URL` (or `ALGOD_SERVER`, with optional `ALGOD_PORT` and `ALGOD_TOKEN`)
- `INDEXER_URL` (or `INDEXER_SERVER`, with optional `INDEXER_PORT` and `INDEXER_TOKEN`)

`ATTESTOR_PQ_SEED` is an optional 32-byte hex seed for the ML-DSA-65 key. When it is unset, the key is derived from the mnemonic with the domain label `pq-attest-mldsa65-v1`, so the mnemonic is not used as the raw ML-DSA seed.

The CLI refuses a connection whose genesis id is not `mainnet-v1.0`.

## Commands

```bash
npm run --silent generate:ed25519
npm run --silent generate:pq
npm run --silent attest -- --txid OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA
npm run --silent attest -- --txid OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA --out bundle.json
npm run --silent verify -- --bundle bundle.json
npm run --silent verify -- --bundle bundle.json --chain
npm test
```

`npm run generate:ed25519` prints a new ed25519 account: an Algorand address and a 25-word mnemonic. Put that mnemonic in `ATTESTOR_MNEMONIC`.

`npm run generate:pq` prints a new Falcon-1024 account (`f1`): the derived Algorand address, the canonical salt, the public key, and a 48-byte `seedHex`. The same seed regenerates the same account. Put `seedHex` in `ATTESTOR_FALCON_SEED`. That account sends the attestation transaction. It is separate from `ATTESTOR_PQ_SEED`, which is the 32-byte ML-DSA-65 key for the proof bundle.

Both commands print the secret on stdout and do not write it unless you pass `--out`. A short reminder goes to stderr.

`npm run attest` prints the bundle JSON to stdout. `--silent` hides npm's script banner so stdout is only that JSON. `--out` also writes the same JSON to a file.

`npm run verify` re-hashes `source.txnBytesBase64` and checks the ML-DSA-65 signature. `--chain` fetches the source and attest transactions from MainNet indexer and checks that the hash and the on-chain note still match. Indexer can lag a few seconds behind confirmation, so `--chain` retries the attest lookup.

## Example

`OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA` is a confirmed MainNet app call (round 65328462, genesis `mainnet-v1.0`).

```bash
npm run --silent attest -- --txid OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA --out bundle.json
npm run --silent verify -- --bundle bundle.json --chain
```

## What done looks like

Stdout is one JSON object. These fields are the check:

- `source.hashSha256` is the SHA-256 of the canonical source transaction. `npm run verify` recomputes it from `source.txnBytesBase64`.
- `attest.txnId` is the confirmed 0 ALGO attestation transaction. Its note is `attest:v1:<sourceTxId>:<sha256hex>`.
- `signature` is an ML-DSA-65 signature over the canonical JSON of `version`, `network`, `source`, `attest`, and `attestor`. `npm run verify` accepts that signature.

`network` is always `algorand-mainnet`.

## Hash preimage

Indexer returns the confirmed transaction as JSON, not the original signed msgpack, and the SDK model turns numbers into `bigint` values that `JSON.stringify` cannot encode. The hash is therefore SHA-256 of the canonical JSON of the entire indexer `transaction` object: object keys sorted at every level, array order kept, no whitespace, no field removed. That includes inner transactions, logs, and confirmation metadata for this app call. `source.txnBytesBase64` is those UTF-8 bytes.

## On-chain signature

The attestation transaction sends 0 ALGO from the Falcon account back to itself. `algosdk` attaches a `pqsig` through `addressWithSignersFromRawFalcon1024Signer` (scheme `f1`). The signature is Algorand's deterministic Falcon-1024 compressed encoding, the form `falcon_det1024_verify_compressed` accepts. A randomized Falcon signature is rejected with `falcon verify failed`. The signature fee is 3000 microAlgo. A 25-word mnemonic is not that key.

Node.js 22 runs the TypeScript sources directly. `npm test` typechecks with TypeScript 7, then runs the unit tests.
