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

    if (parsedProof.data.challengeId !== challengeId) {
      return { ok: false, reason: 'proof challengeId mismatch' }
    }

    if (parsedProof.data.nonce !== record.challenge.nonce) {
      return { ok: false, reason: 'proof nonce mismatch' }
    }

    if (parsedProof.data.tier !== record.challenge.tier) {
      return { ok: false, reason: 'proof tier mismatch' }
    }

    const issuedAt = Date.parse(record.challenge.issuedAt)
    const paidAt = Date.parse(parsedProof.data.paidAt)
    if (Number.isNaN(paidAt) || Number.isNaN(issuedAt) || paidAt < issuedAt) {
      return { ok: false, reason: 'proof paidAt invalid' }
    }

    if (parsedProof.data.paidAmountUsd <= 0) {
      return { ok: false, reason: 'paidAmountUsd must be greater than zero' }
    }

    const expectedDigest = digestForProof(record.challenge, parsedProof.data.agentId, parsedProof.data.tier)
    const expectedLegacySignature = hashForProofLegacy(record.challenge, parsedProof.data.agentId, parsedProof.data.tier, this.signerSecret)
    const hasDigestPrefix = parsedProof.data.signature === expectedDigest || parsedProof.data.signature.startsWith(`${expectedDigest}-`)
    const legacyMatch = parsedProof.data.signature === expectedLegacySignature
    if (!hasDigestPrefix && !legacyMatch) {
      return { ok: false, reason: 'invalid signature' }
    }

    if (record.agentId !== parsedProof.data.agentId) {
      return { ok: false, reason: 'agentId mismatch' }
    }

    return { ok: true, challenge: record.challenge }
  }
}

function digestForProof(challenge: PaymentChallenge, agentId: string, tier: string): string {
  const payload = JSON.stringify({
    challengeId: challenge.challengeId,
    resource: challenge.resource,
    tier: challenge.tier,
    nonce: challenge.nonce,
    agentId,
    tierKey: tier
  })
  return createHash('sha256').update(payload).digest('hex')
}

function hashForProofLegacy(challenge: PaymentChallenge, agentId: string, tier: string, secret: string): string {
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
