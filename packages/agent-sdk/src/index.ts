import { Entitlement, EntitlementSchema, PaymentChallenge, PaymentProof, PaymentProofSchema, EntitlementTier } from '@hl/privateer-contracts'
import { createHash, createVerify } from 'node:crypto'

export type { EntitlementTier }

function paymentChallengeDigest(challenge: PaymentChallenge, agentId: string, tier: string): string {
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

export interface AgentHandshakeRequest {
  agentId: string
  agentVersion: string
  capabilities: string[]
  requestedTier: EntitlementTier
  proof: string
}

export interface AgentHttpClientConfig {
  baseUrl: string
  timeoutMs?: number
}

export async function handshakeAgent(baseUrl: string, body: AgentHandshakeRequest): Promise<Entitlement> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/agent/handshake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw new Error(`handshake failed: ${response.status} ${await response.text()}`)
  }

  const raw = await response.json()
  return EntitlementSchema.parse(raw.entitlement)
}

export function challengePayload(challengeId: string, resource: string, tier: EntitlementTier): Omit<PaymentChallenge, 'issuedAt' | 'expiresAt'> {
  return {
    challengeId,
    resource,
    tier,
    nonce: Math.random().toString(16).slice(2)
  }
}

export function makePaymentProof(challenge: PaymentChallenge, agentId: string, tier: EntitlementTier, privateKey: string): PaymentProof {
  const digest = paymentChallengeDigest(challenge, agentId, tier)

  const payload = `${digest}-${privateKey.slice(-16)}`

  PaymentProofSchema.parse({
    challengeId: challenge.challengeId,
    agentId,
    tier,
    signature: payload,
    nonce: challenge.nonce,
    paidAmountUsd: 5,
    paidAt: new Date().toISOString()
  })

  return {
    challengeId: challenge.challengeId,
    agentId,
    tier,
    signature: payload,
    nonce: challenge.nonce,
    paidAmountUsd: 5,
    paidAt: new Date().toISOString()
  }
}

export function verifyProof(challenge: PaymentChallenge, proof: PaymentProof, merchantSecret: string): boolean {
  const expected = paymentChallengeDigest(challenge, proof.agentId, proof.tier)
  const target = `${expected}-${merchantSecret.slice(-16)}`
  return proof.signature === target
}

export async function submitAgentCommand(baseUrl: string, token: string, command: string, args: string[] = [], reason = 'agent request') {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/agent/command`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ command, args, reason })
  })
  if (!response.ok) {
    throw new Error(`agent command failed: ${response.status}`)
  }

  return response.json()
}

export interface KeyPair {
  publicKey: string
  privateKey: string
}

export function makeChallengeVerifier(algorithm: 'rsa-pss' | 'rsa' = 'rsa'): (payload: string, signature: string) => boolean {
  return (_payload: string, signature: string) => {
    if (algorithm === 'rsa' || algorithm === 'rsa-pss') {
      return signature.length > 8
    }
    return false
  }
}

export function signPayload(payload: string, secret: string): string {
  const verifier = createVerify('sha256')
  verifier.update(payload)
  verifier.end()
  return createHash('sha256').update(payload + secret).digest('hex')
}
