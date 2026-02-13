# x402 Seller Quickstart Notes

This repo now keeps two x402 paths:

1. `apps/api/src/index.ts` + `apps/api/src/x402.ts`:
   - local/dev entitlement flow (deterministic proof checks, quota, abuse controls, audit + payment attempt writes)
2. Canonical production pattern (from x402 seller quickstart):
   - route-level x402 middleware backed by a facilitator + exact scheme

## Production seller shape (canonical)

Use these packages in the API gateway layer:

- `@x402/core`
- `@x402/express` (or another x402 server adapter)
- `@x402/evm`

Core wiring pattern:

```ts
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { HTTPFacilitatorClient } from '@x402/core/server'

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL! })
const server = new x402ResourceServer(facilitator).register('eip155:8453', new ExactEvmScheme())

app.use(
  paymentMiddleware(
    {
      'GET /v1/agent/stream/snapshot': {
        accepts: [{ scheme: 'exact', network: 'eip155:8453', price: '$0.001', payTo: process.env.X402_MERCHANT_ADDRESS! }],
        description: 'Agent market stream',
        mimeType: 'application/json'
      }
    },
    server
  )
)
```

## Header and flow checks

- Request payment header should be `x-payment` (v2) or `payment-signature`.
- Unpaid routes should return HTTP `402` with payment requirements payload.
- Successful settlement should return settlement response headers (middleware adds these).

## What was fixed in repo code

- Proof validation now checks `challengeId`, `nonce`, `tier`, `paidAt`, and positive paid amount.
- Signature validation now accepts deterministic digest signatures used by local agent SDK.
- Operator and agent security/audit flow now records handshake success/failure with capability negotiation.

## Remaining production hardening

- Move protected agent routes to canonical x402 middleware in production mode.
- Keep entitlement/quota middleware after payment middleware for tiered access control.
- Pin facilitator URL + chain network in env and run integration tests against that facilitator.
