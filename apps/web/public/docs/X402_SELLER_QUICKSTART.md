# HL Privateer x402 Seller Quickstart

This project uses an entitlement-gated x402 flow for paid agent routes.

## Canonical agent flow
1. `POST /v1/agent/handshake`
2. `POST /v1/agent/verify`
3. Call paid routes with `x-agent-entitlement`

## Network and settlement context
- Network: `eip155:8453` (Base)
- Asset: USDC
- Facilitator URL: `https://facilitator.payai.network`

## Step 1: Handshake

```bash
curl -s https://api.hlprivateer.xyz/v1/agent/handshake \
  -H 'content-type: application/json' \
  -d '{
    "agentId": "agent-demo",
    "requestedTier": "tier1",
    "proof": "bootstrap-proof-token",
    "requestedCapabilities": ["stream.read.public", "analysis.read"]
  }'
```

Response includes `challenge.challengeId` and provisional entitlement metadata.

## Step 2: Verify

```bash
curl -s https://api.hlprivateer.xyz/v1/agent/verify \
  -H 'content-type: application/json' \
  -d '{
    "challengeId": "<challengeId-from-handshake>",
    "proof": {
      "challengeId": "<challengeId-from-handshake>",
      "agentId": "agent-demo",
      "tier": "tier1",
      "nonce": "<nonce-from-handshake>",
      "paidAmountUsd": 1,
      "paidAt": "2026-02-23T00:00:00.000Z",
      "signature": "<signed-proof>"
    }
  }'
```

On success:

```json
{
  "verified": true,
  "entitlementId": "<challengeId>",
  "entitlement": {
    "agentId": "agent-demo",
    "tier": "tier1",
    "capabilities": ["stream.read.public", "analysis.read"],
    "expiresAt": "...",
    "quotaRemaining": 1000,
    "rateLimitPerMinute": 30
  }
}
```

## Step 3: Paid reads with entitlement header

```bash
curl -s https://api.hlprivateer.xyz/v1/agent/stream/snapshot \
  -H 'x-agent-entitlement: <challengeId>'
```

If header is missing or unverified, server returns `402 PAYMENT_REQUIRED` with next-step guidance.

## Discovery docs
- `https://hlprivateer.xyz/.well-known/x402`
- `https://hlprivateer.xyz/.well-known/agents.json`
- `https://hlprivateer.xyz/.well-known/agent-registration.json`
