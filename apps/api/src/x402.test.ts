import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { X402Service } from './x402'

function signatureFor(
  challenge: { challengeId: string; resource: string; tier: string; nonce: string },
  agentId: string,
  tier: string
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        challengeId: challenge.challengeId,
        resource: challenge.resource,
        tier: challenge.tier,
        nonce: challenge.nonce,
        agentId,
        tierKey: tier
      })
    )
    .digest('hex')

  return `${digest}-agent-proof`
}

describe('x402 service', () => {
  it('verifies challenge proof with digest signature', () => {
    const service = new X402Service('test-secret')
    const challenge = service.createChallenge('agent-1', '/v1/agent/command', 'tier1')
    const proof = {
      challengeId: challenge.challengeId,
      agentId: 'agent-1',
      tier: 'tier1',
      signature: signatureFor(challenge, 'agent-1', 'tier1'),
      nonce: challenge.nonce,
      paidAmountUsd: 1,
      paidAt: new Date().toISOString()
    }

    const result = service.verifyProof(challenge.challengeId, proof)
    expect(result.ok).toBe(true)
  })

  it('rejects proofs with nonce mismatches', () => {
    const service = new X402Service('test-secret')
    const challenge = service.createChallenge('agent-1', '/v1/agent/command', 'tier1')
    const proof = {
      challengeId: challenge.challengeId,
      agentId: 'agent-1',
      tier: 'tier1',
      signature: signatureFor(challenge, 'agent-1', 'tier1'),
      nonce: `${challenge.nonce}-bad`,
      paidAmountUsd: 1,
      paidAt: new Date().toISOString()
    }

    const result = service.verifyProof(challenge.challengeId, proof)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('nonce')
  })
})
