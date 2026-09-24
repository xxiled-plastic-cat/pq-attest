# pq-attest

TypeScript service for attesting a confirmed transaction from Algorand, Base, Ethereum, Polygon, Arbitrum, Optimism, Avalanche, Solana, Bitcoin, Aptos, Sui, NEAR, TON, Hedera, Stellar, or XRPL. It fetches the transaction, SHA-256s a canonical record of it, submits a 0 ALGO transaction whose note commits to that hash, and returns a proof bundle signed with ML-DSA-65. The attestation transaction is always on Algorand MainNet.

The CLI prints that bundle. The HTTP API returns the same JSON. The API charges 0.001 USDC for `POST /attest` and leaves `POST /verify` free. Sources other than Base and Solana are paid in Algorand USDC. A Base source can be paid in Base USDC or Algorand USDC. A Solana source can be paid in Solana USDC or Algorand USDC. There is no state proof in the bundle. The 0 ALGO transaction only carries the attestation note. It is authorized with a Falcon-1024 account (`f1`). The ML-DSA-65 signature is over the proof bundle, not the Algorand transaction.

The human front door is an Astro site in [`site/`](site/). `npm install` inside that directory, then `npm run site` from here (or `npm run dev` inside `site/`).

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
npm run --silent attest -- --txid OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA --chain algorand
npm run --silent attest -- --txid OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA --chain algorand --out bundle.json
npm run --silent verify -- --bundle bundle.json
npm run --silent verify -- --bundle bundle.json --chain
npm test
```

`npm run generate:ed25519` prints a new ed25519 account: an Algorand address and a 25-word mnemonic. Put that mnemonic in `ATTESTOR_MNEMONIC`.

`npm run generate:pq` prints a new Falcon-1024 account (`f1`): the derived Algorand address, the canonical salt, the public key, and a 48-byte `seedHex`. The same seed regenerates the same account. Put `seedHex` in `ATTESTOR_FALCON_SEED`. That account sends the attestation transaction. It is separate from `ATTESTOR_PQ_SEED`, which is the 32-byte ML-DSA-65 key for the proof bundle.

Both commands print the secret on stdout and do not write it unless you pass `--out`. A short reminder goes to stderr.

`npm run attest` prints the bundle JSON to stdout. `--silent` hides npm's script banner so stdout is only that JSON. `--out` also writes the same JSON to a file.

`npm run verify` re-hashes `source.txnBytesBase64` and checks the ML-DSA-65 signature. `--chain` fetches the source and attest transactions from MainNet indexer and checks that the hash and the on-chain note still match. Indexer can lag a few seconds behind confirmation, so `--chain` retries the attest lookup.

`npm start` runs the API on `127.0.0.1:3000`. `POST /attest` requires payment on that port too.

## HTTP

`POST /attest` with `{ "txid": "<id>", "chain": "<network>" }` and no `PAYMENT-SIGNATURE` returns `402` and a `PAYMENT-REQUIRED` header. `chain` is required. The id must match that chain: Algorand is 52 base32 characters, Hedera is `shard.realm.num@seconds.nanos`, Solana is an 87–88 character signature, Base, Ethereum, Polygon, Arbitrum, Optimism, Avalanche, and Aptos are `0x` plus 64 hex characters, Bitcoin, Stellar, and XRPL are 64 hex characters, Sui and NEAR are 43–44 character base58 digests, and TON is 64 hex characters or base64. A mismatch is `400`.

Pay 0.001 USDC and retry with `PAYMENT-SIGNATURE`. An Algorand source accepts only Algorand USDC to `X402_PAY_TO`. A Base source accepts that same Algorand payment, and Base USDC (`eip155:8453`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) to `X402_PAY_TO_BASE`. A Solana source accepts that same Algorand payment, and Solana USDC (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) to `X402_PAY_TO_SOLANA`. Every rail is settled by `FACILITATOR_URL`. The signature must match one advertised option. A `200` body is the proof bundle JSON. The API verifies the signature before attesting, then settles after a successful bundle. A successful response includes `PAYMENT-RESPONSE`. A failed attest is not settled. Each paid call submits a new 0 ALGO attestation. There is no cache.

`POST /verify` with the bundle JSON returns `{ "ok": true, "chain": false, "source": { "txnId", "hashSha256" } }`. `?chain=1` re-fetches the source and the attestation. An Algorand source comes from MainNet indexer. Other sources come from that chain’s configured API. The attestation transaction always comes from the Algorand indexer. This is the same check as `npm run verify -- --chain`.

`GET /health`, `GET /ready`, `GET /discovery`, and `GET /openapi.json` are free. Discovery and OpenAPI read `X402_PRICE_ATTEST_USDC`, `X402_PAY_TO`, `X402_PAY_TO_BASE`, `X402_PAY_TO_SOLANA`, `X402_NETWORK`, `X402_SCHEME`, and `FACILITATOR_URL`. The default price is 0.001 USDC, which is 1000 atomic units. Algorand USDC is asset `31566704`. Base USDC, Solana USDC, and Algorand USDC are settled by `https://facilitator.goplausible.xyz`. A rail is advertised only when its pay-to address is set. A Base request returns 500 when neither Base pay-to is set. A Solana request returns 500 when neither Solana pay-to is set.

```bash
cp .env.example .env
npm start
curl -i http://127.0.0.1:3000/health
curl -i -X POST http://127.0.0.1:3000/attest \
  -H 'content-type: application/json' \
  -d '{"txid":"OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA","chain":"algorand"}'
curl -i -X POST http://127.0.0.1:3000/verify \
  -H 'content-type: application/json' \
  --data-binary @bundle.json
```

`/health` is `200`. `/attest` without a payment header is `402` and includes `PAYMENT-REQUIRED`.

`X402_PAY_TO` must be an Algorand address. An Algorand source returns 500 while it is empty. `X402_PAY_TO_BASE` is the Base address for Base USDC. `X402_PAY_TO_SOLANA` is the Solana address for Solana USDC. `BASE_RPC_URL` defaults to `https://mainnet.base.org`.

## Cloudflare

[`wrangler.jsonc`](wrangler.jsonc) deploys the API as a Worker at `https://api.pqattest.com`. `POST /attest` runs in that Worker, including the payment check.

```bash
npx wrangler secret put X402_PAY_TO
npx wrangler secret put ATTESTOR_MNEMONIC
npx wrangler secret put ATTESTOR_FALCON_SEED
npx wrangler secret put ATTESTOR_PQ_SEED
npx wrangler deploy
```

Public AlgoNode URLs, the Base RPC URL, the 0.001 price, the network, the scheme, and the facilitator URL are `vars` in `wrangler.jsonc`. The attestor keys, `X402_PAY_TO`, `X402_PAY_TO_BASE`, and `X402_PAY_TO_SOLANA` are secrets.

## MCP

[`mcp-worker/`](mcp-worker/) is a separate Worker. It exposes `pq_attest` and `pq_verify` over Streamable HTTP and proxies them to the public API. It does not hold attestor keys.

Cloudflare Git deploy uses Worker root `mcp-worker`. The public API is `https://api.pqattest.com`. The MCP endpoint is `https://mcp.pqattest.com/mcp`.

```bash
npm run mcp:dev
npm run mcp:test
```

## Example

`OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA` is a confirmed MainNet app call (round 65328462, genesis `mainnet-v1.0`).

```bash
npm run --silent attest -- --txid OZ24DXUP6W3YIKK2KZ642WG2EAAIYJZE2IDGHCKMWOUERNL4UKWA --chain algorand --out bundle.json
npm run --silent verify -- --bundle bundle.json --chain
```

## What done looks like

Stdout is one JSON object. These fields are the check:

- `source.hashSha256` is the SHA-256 of the canonical source transaction. `npm run verify` recomputes it from `source.txnBytesBase64`.
- `attest.txnId` is the confirmed 0 ALGO attestation transaction. Its note is `attest:v1:<sourceTxId>:<sha256hex>`.
- `signature` is an ML-DSA-65 signature over the canonical JSON of `version`, `network`, `source`, `attest`, and `attestor`. `npm run verify` accepts that signature.

`network` is always `algorand-mainnet`, because that is where the attestation transaction is confirmed. Every source other than Algorand sets `source.chain`. Bundles without `source.chain` are Algorand sources.

## Hash preimage

Indexer returns the confirmed transaction as JSON, not the original signed msgpack, and the SDK model turns numbers into `bigint` values that `JSON.stringify` cannot encode. The hash is therefore SHA-256 of the canonical JSON of the entire indexer `transaction` object: object keys sorted at every level, array order kept, no whitespace, no field removed. That includes inner transactions, logs, and confirmation metadata for this app call. `source.txnBytesBase64` is those UTF-8 bytes.

Other sources use a fixed field set, the same way Base does, rather than the raw API payload. Base, Ethereum, Polygon, Arbitrum, Optimism, and Avalanche share that EVM document and are distinguished by `chainId` (`8453`, `1`, `137`, `42161`, `10`, and `43114`). Avalanche is the C-Chain. XRPL is loaded by hash from `XRPL_API_URL` (xrplcluster by default) with the rippled `tx` method, and only a validated ledger entry is accepted. A failed but confirmed transaction is allowed. A canonical document over 1 MB is rejected. NEAR is loaded by hash from `NEAR_API_URL` (NearBlocks by default), because the protocol RPC also needs the sender account. TON is loaded by hash from `TON_API_URL` (TonAPI by default), because a native lookup also needs the account and logical time.

## On-chain signature

The attestation transaction sends 0 ALGO from the Falcon account back to itself. `algosdk` attaches a `pqsig` through `addressWithSignersFromRawFalcon1024Signer` (scheme `f1`). The signature is Algorand's deterministic Falcon-1024 compressed encoding, the form `falcon_det1024_verify_compressed` accepts. A randomized Falcon signature is rejected with `falcon verify failed`. The signature fee is 3000 microAlgo. A 25-word mnemonic is not that key.

Node.js 22 runs the TypeScript sources directly. `npm test` typechecks with TypeScript 7, then runs the unit tests.
