# PQ Attest

Instructions for agents working with this service.

## Payment
POST https://api.pqattest.com/attest is x402-paid. On HTTP 402, read the PAYMENT-REQUIRED header (base64 JSON), pay one advertised requirement, then retry the same request with PAYMENT-SIGNATURE.

## Endpoints
- POST /attest — { "txid": string, "chain": string } — 0.001 USDC. chain is required and the transaction id must match it. An Algorand source is paid in Algorand USDC. A Base source can be paid in Base USDC or Algorand USDC. A Solana source can be paid in Solana USDC or Algorand USDC.
- POST /verify — proof bundle JSON — free. Pass ?chain=1 to re-fetch both transactions.

## Notes
- Prices are advertised in the 402.
- Settlement is handled by https://facilitator.goplausible.xyz.
- MCP: https://mcp.pqattest.com/mcp. Tools: pq_attest (paid), pq_verify (free).
