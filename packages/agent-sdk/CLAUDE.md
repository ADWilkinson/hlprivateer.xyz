# Agent SDK - Development Context

## Overview
External agent client library for handshake, payment proof generation, and command submission against the HL Privateer API. Used by third-party bots.

## Key Files
```
src/
├── index.ts       # Public API: handshake, proof gen, command submit
└── index.test.ts  # Unit tests
```

## API Surface

**`handshakeAgent(baseUrl, body)`**: POST `/v1/agent/handshake` → entitlement with capabilities, quota, expiry.

**`makePaymentProof(challenge, agentId, tier, privateKey)`**: Generate SHA-256 proof for x402 challenge. Signature: `${digest}-${privateKey.slice(-16)}`.

**`submitAgentCommand(baseUrl, token, command, args, reason)`**: POST `/v1/agent/command` with Bearer token.

**`verifyProof(challenge, proof, merchantSecret)`**: Verify proof (for testing). Matches API's `x402.ts` verification.

## Usage
```typescript
import { handshakeAgent, makePaymentProof, submitAgentCommand } from '@hl/privateer-agent-sdk'

const entitlement = await handshakeAgent(baseUrl, { agentId, agentVersion, capabilities, requestedTier, proof })
const proof = makePaymentProof(challenge, agentId, 'tier1', privateKey)
const result = await submitAgentCommand(baseUrl, entitlement.challengeId, '/status', [])
```

## Design
- Minimal deps (zod + contracts only)
- Stateless (caller manages entitlements)
- Fail-fast validation (Zod parse errors)
- Compatible with API's `x402.ts` verifier
