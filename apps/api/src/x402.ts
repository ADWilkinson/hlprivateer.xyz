import { Entitlement, EntitlementSchema, PaymentChallenge, PaymentChallengeSchema, PaymentProofSchema } from '@hl/privateer-contracts'
import { ulid } from 'ulid'
import { env } from './config'
import { createHash } from 'node:crypto'

export interface ChallengeRecord {
  challenge: PaymentChallenge
  agentId: string
}

export class X402Service {
  private challenges = new Map<string, ChallengeRecord>()

  constructor(private signerSecret: string) {}

  createChallenge(agentId: string, resource: string, tier: PaymentChallenge['tier']): PaymentChallenge {
    const now = new Date()
    const challenge = {
      challengeId: ulid(),
      resource,
      tier,
      nonce: ulid(),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    }

    PaymentChallengeSchema.parse(challenge)
    this.challenges.set(challenge.challengeId, { challenge, agentId })
    return challenge
  }

  verifyProof(challengeId: string, proof: unknown): { ok: boolean; reason?: string; challenge?: PaymentChallenge } {
    if (!env.X402_ENABLED) {
      return { ok: true }
    }

    const parsedProof = PaymentProofSchema.safeParse(proof)
    if (!parsedProof.success) {
      return { ok: false, reason: 'invalid proof format' }
    }

    const record = this.challenges.get(challengeId)
    if (!record) {
      return { ok: false, reason: 'unknown challengeId' }
    }

    if (record.challenge.expiresAt < new Date().toISOString()) {
      this.challenges.delete(challengeId)
      return { ok: false, reason: 'challenge expired' }
    }

    const expectedSignature = hashForProof(record.challenge, parsedProof.data.agentId, parsedProof.data.tier, this.signerSecret)
    if (expectedSignature !== parsedProof.data.signature) {
      return { ok: false, reason: 'invalid signature' }
    }

    if (record.agentId !== parsedProof.data.agentId) {
      return { ok: false, reason: 'agentId mismatch' }
    }

    return { ok: true, challenge: record.challenge }
  }
}

function hashForProof(challenge: PaymentChallenge, agentId: string, tier: string, secret: string): string {
  const raw = `${challenge.challengeId}:${agentId}:${tier}:${challenge.nonce}:${secret}`
  return createHash('sha256').update(raw).digest('hex')
}

const x402 = new X402Service(env.X402_VERIFIER_SECRET)

export function getX402Service() {
  return x402
}

export function createChallenge(agentId: string, resource: string, tier: PaymentChallenge['tier']) {
  return x402.createChallenge(agentId, resource, tier)
}

export function verifyChallenge(challengeId: string, proof: unknown) {
  return x402.verifyProof(challengeId, proof)
}
