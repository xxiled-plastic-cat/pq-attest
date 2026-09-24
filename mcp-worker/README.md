# @pq-attest/mcp-worker

Stateless remote MCP server for pq-attest, designed for Cloudflare Workers deployment via Cloudflare's Git integration UI.

## Purpose

- Exposes pq-attest tools over remote MCP (Streamable HTTP)
- Calls the public API (`PQ_ATTEST_API_URL`)
- Never stores attestor keys or wallet mnemonics
- `pq_attest` is paid: the first call returns payment requirements; the retry forwards `PAYMENT-SIGNATURE`
- `pq_verify` is free
- Resource `pq-attest://discovery` publishes the live `GET /discovery` document

The worker does not sign, settle, or submit the attestation transaction. Those stay on the API.

## Local development

From the repo root:

```sh
npm run mcp:dev
```

From this folder:

```sh
npm run dev
```

## Cloudflare Dashboard deployment (Git)

1. In Cloudflare Workers, choose **Create Worker** and connect GitHub.
2. Select repository `pq-attest`.
3. Set the Worker root directory to `mcp-worker`.
4. Configure Worker variables:
   - `PQ_ATTEST_API_URL=https://api.pqattest.com`
   - `PQ_ATTEST_MCP_PUBLIC_URL=https://mcp.pqattest.com/mcp`
5. The Worker route is the custom domain `mcp.pqattest.com`.

Do not put `ATTESTOR_MNEMONIC`, `ATTESTOR_FALCON_SEED`, or `ATTESTOR_PQ_SEED` on this Worker. Those secrets belong on the API.

## Runtime endpoints

- `GET /health` (and `/`) health check
- `GET /.well-known/mcp` MCP endpoint metadata
- `POST` and `DELETE /mcp` Streamable HTTP MCP endpoint (`GET` returns `405` Allow `POST, DELETE`)

## Scripts

```sh
npm run mcp:typecheck
npm run mcp:test
npm run mcp:dev
npm run mcp:deploy
```
