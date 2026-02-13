import { beforeEach, describe, expect, it } from 'vitest'
import { challengePayload, makePaymentProof, verifyProof, type EntitlementTier } from './index'

let secret: string

beforeEach(() => {
  secret = 'private-test-secret'
})

describe('agent sdk', () => {
  it('derives a valid proof flow', async () => {
    const challenge = challengePayload('challenge-1', '/v1/agent/command', 'tier1' as EntitlementTier)
    const proof = makePaymentProof(
      {
        challengeId: challenge.challengeId,
        resource: '/v1/agent/command',
        tier: challenge.tier,
        nonce: challenge.nonce,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
      },
      'agent-1',
      'tier1',
      secret
    )

    expect(verifyProof(
      {
        challengeId: challenge.challengeId,
        resource: '/v1/agent/command',
        tier: 'tier1',
        nonce: challenge.nonce,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString()
      },
      proof,
      secret
    )).toBeTruthy()
  })
})
