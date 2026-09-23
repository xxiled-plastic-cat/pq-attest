# pq-attest

TypeScript service for attesting a confirmed Algorand MainNet transaction. It fetches the transaction, SHA-256s the full indexer document, submits a 0 ALGO transaction whose note commits to that hash, and returns a proof bundle signed with ML-DSA-65.

The CLI prints that bundle. The HTTP API returns the same JSON. Caddy, in the same container, charges 0.0001 USDC on Algorand for `POST /attest` and leaves `POST /verify` free. The API process does not check payment. There is no state proof in the bundle. The 0 ALGO transaction only carries the attestation note. It is authorized with a Falcon-1024 account (`f1`). The ML-DSA-65 signature is over the proof bundle, not the Algorand transaction.

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

`npm start` runs the API on `127.0.0.1:3000` with no paywall. Payment is enforced only by Caddy.

## HTTP

Caddy listens on port 8080. The API listens on `127.0.0.1:3000` in the same container, so callers cannot skip the paywall.

`POST /attest` with `{ "txid": "<id>" }` and no `PAYMENT-SIGNATURE` returns `402` and a `PAYMENT-REQUIRED` header. Pay 0.0001 USDC on Algorand to `X402_PAY_TO`, retry with `PAYMENT-SIGNATURE`, and a `200` body is the proof bundle JSON. A successful response may include `PAYMENT-RESPONSE`. Each paid call submits a new 0 ALGO attestation. There is no cache.

`POST /verify` with the bundle JSON returns `{ "ok": true, "chain": false, "source": { "txnId", "hashSha256" } }`. `?chain=1` re-fetches both transactions from MainNet, the same check as `npm run verify -- --chain`.

`GET /health`, `GET /ready`, `GET /discovery`, and `GET /openapi.json` are free. Discovery and OpenAPI read `X402_PRICE_ATTEST_USDC`, `X402_PAY_TO`, `X402_NETWORK`, `X402_SCHEME`, and `FACILITATOR_URL`, the same variables Caddy uses. The default price is 0.0001 USDC, which is 100 micro-USDC of asset `31566704` on `algorand-mainnet`, settled by `https://facilitator.goplausible.xyz`.

```bash
cp .env.example .env
docker compose up --build
curl -i http://localhost:8080/health
curl -i -X POST http://localhost:8080/attest \
  -H 'content-type: application/json' \
  -d '{"txid":"OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA"}'
curl -i -X POST http://localhost:8080/verify \
  -H 'content-type: application/json' \
  --data-binary @bundle.json
```

`/health` is `200`. `/attest` without a payment header is `402` and includes `PAYMENT-REQUIRED`.

`X402_PAY_TO` must be an Algorand address. Caddy exits on startup when it is empty. Attestor secrets stay in the environment and are not written into the image.

## Cloudflare

[`wrangler.jsonc`](wrangler.jsonc) runs this image as one Cloudflare Container (`standard-1`, one instance). The Worker calls `getByName("singleton")` and fetches port 8080 only, so the Falcon account is not used from two replicas.

```bash
npx wrangler secret put X402_PAY_TO
npx wrangler secret put ATTESTOR_MNEMONIC
npx wrangler secret put ATTESTOR_FALCON_SEED
npx wrangler deploy
```

Public AlgoNode URLs, the 0.0001 price, the network, the scheme, and the facilitator URL are `vars` in `wrangler.jsonc`. The Worker passes those, plus the secrets, into the container when it starts. Changing a secret does not update a container that is already running. Stop that instance so the next request starts it again with the new values.

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
