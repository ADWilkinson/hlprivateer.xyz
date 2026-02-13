# x402 Seller Quickstart Notes

This repo currently has:

1. A **local/dev payment-gate** used by the agent SDK:
   - `apps/api/src/index.ts` + `apps/api/src/x402.ts`
   - deterministic proof checks, quota, abuse controls, audit + payment-attempt writes
2. Reference notes for the **canonical x402 v2 seller flow** (middleware + facilitator) as documented by x402.
3. A **canonical x402 v2 facilitator-backed gate** (optional, enabled by config):
   - `apps/api/src/x402-facilitator.ts`
   - `X402_PROVIDER=facilitator` to enforce canonical `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`
   - Paid routes (currently): `GET /v1/agent/stream/snapshot`, `GET /v1/agent/analysis/latest`, `GET /v1/agent/analysis`, `GET /v1/agent/positions`, `GET /v1/agent/orders`

If you need actual x402 v2 interoperability (buyers retry with `PAYMENT-SIGNATURE`, sellers return `PAYMENT-REQUIRED` + `PAYMENT-RESPONSE`), follow the canonical flow below.

## Local repo demo (x402-like gate)

Run against the local API (`http://127.0.0.1:4000`), showing:
- `402` response with `PAYMENT-REQUIRED`
- paid retry with `PAYMENT-SIGNATURE`
- reuse of `x-agent-entitlement` without re-paying until quota/expiry

```bash
bun scripts/x402/demo.ts
```

## Canonical repo demo (facilitator-backed)

This uses the real x402 client libraries to:
- fetch a paid agent route
- receive `402` + `PAYMENT-REQUIRED`
- create a signed payment payload
- retry with `PAYMENT-SIGNATURE`
- read the `PAYMENT-RESPONSE` settlement header

Prereqs:
- API configured with `X402_PROVIDER=facilitator` and `X402_PAYTO` set.
- Payer EVM wallet funded with the required stablecoin on the configured `X402_NETWORK` (default `eip155:84532` / Base Sepolia).

Run:

```bash
API_BASE_URL=http://127.0.0.1:4000 \\
X402_PAYER_PRIVATE_KEY=0x... \\
bun scripts/x402/facilitator-demo.ts
```

## Canonical x402 v2 seller shape (Express example)

Install:

```bash
npm install @x402/express @x402/core @x402/evm
```

Wire middleware (testnet facilitator + Base Sepolia network ID):

```ts
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server'
import { registerExactEvmScheme } from '@x402/evm/exact/server'

const app = express()

// Your receiving wallet address.
const payTo = process.env.X402_MERCHANT_ADDRESS!

// Facilitator (testnet). For mainnet, follow x402 docs "Running on Mainnet".
const facilitatorClient = new HTTPFacilitatorClient({ url: 'https://x402.org/facilitator' })

const server = new x402ResourceServer(facilitatorClient)
registerExactEvmScheme(server)

app.use(
  paymentMiddleware(
    {
      'GET /weather': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.001', // USDC amount in dollars
            network: 'eip155:84532', // Base Sepolia (CAIP-2 format)
            payTo
          }
        ],
        description: 'Get current weather data for any location',
        mimeType: 'application/json'
      }
    },
    server
  )
)

app.get('/weather', (_req, res) => {
  res.send({ report: { weather: 'sunny', temperature: 70 } })
})

app.listen(4021, () => {
  console.log('Server listening at http://localhost:4021')
})
```

## Header and flow checks (x402 v2)

- Unpaid request:
  - server responds `402 Payment Required`
  - includes payment instructions in the `PAYMENT-REQUIRED` header
- Paid retry:
  - client retries with `PAYMENT-SIGNATURE` header containing a Base64-encoded JSON payment payload
- Successful response:
  - server returns the normal 200 payload
  - includes `PAYMENT-RESPONSE` header containing a Base64-encoded JSON settlement response

## Notes For This Repo

- The current `apps/api` flow is **not** a full facilitator-backed x402 settlement implementation; it is a local deterministic verifier intended for internal agent SDK testing.
- If/when we switch to canonical x402 for paid agent routes, the local entitlement/quota checks can remain as a second stage after payment verification.
