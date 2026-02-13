import { createHash } from 'node:crypto'

type PaymentChallenge = {
  challengeId: string
  resource: string
  tier: 'tier0' | 'tier1' | 'tier2' | 'tier3'
  nonce: string
  issuedAt: string
  expiresAt: string
}

type PaymentRequiredHeader = {
  challenge: PaymentChallenge
}

type PaymentProof = {
  challengeId: string
  agentId: string
  tier: PaymentChallenge['tier']
  signature: string
  nonce: string
  paidAmountUsd: number
  paidAt: string
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function decodeBase64Json<T>(value: string): T {
  const decoded = Buffer.from(value, 'base64').toString('utf8')
  return JSON.parse(decoded) as T
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

function makeProof(challenge: PaymentChallenge, agentId: string): PaymentProof {
  const payload = JSON.stringify({
    challengeId: challenge.challengeId,
    resource: challenge.resource,
    tier: challenge.tier,
    nonce: challenge.nonce,
    agentId,
    tierKey: challenge.tier
  })
  const digest = sha256Hex(payload)

  // The repo's dev verifier accepts either the digest or a digest-prefixed payload.
  const signature = digest

  return {
    challengeId: challenge.challengeId,
    agentId,
    tier: challenge.tier,
    signature,
    nonce: challenge.nonce,
    paidAmountUsd: 5,
    paidAt: new Date(Date.now() + 1000).toISOString()
  }
}

async function main() {
  const baseUrl = (process.env.API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '')
  const route = process.env.X402_ROUTE ?? '/v1/agent/stream/snapshot'
  const agentId = process.env.AGENT_ID ?? 'agent'

  console.log(`baseUrl=${baseUrl}`)
  console.log(`route=${route}`)
  console.log(`agentId=${agentId}`)
  console.log('')

  const first = await fetch(`${baseUrl}${route}`, { method: 'GET' })
  const firstText = await first.text()
  console.log(`first status=${first.status}`)
  if (first.status !== 402) {
    console.log(firstText)
    process.exitCode = 1
    return
  }

  const paymentRequired = first.headers.get('payment-required')
  if (!paymentRequired) {
    console.error('missing PAYMENT-REQUIRED header')
    process.exitCode = 1
    return
  }

  const requiredPayload = decodeBase64Json<PaymentRequiredHeader>(paymentRequired)
  const challenge = requiredPayload.challenge
  console.log('challengeId=', challenge.challengeId)
  console.log('tier=', challenge.tier)
  console.log('')

  const proof = makeProof(challenge, agentId)
  const paymentSignature = encodeBase64Json(proof)

  const second = await fetch(`${baseUrl}${route}`, {
    method: 'GET',
    headers: {
      'payment-signature': paymentSignature
    }
  })

  const secondText = await second.text()
  console.log(`retry status=${second.status}`)
  if (!second.ok) {
    console.log(secondText)
    process.exitCode = 1
    return
  }

  const paymentResponse = second.headers.get('payment-response')
  if (paymentResponse) {
    const responsePayload = decodeBase64Json<{ ok?: boolean; entitlementId?: string }>(paymentResponse)
    console.log('payment-response=', responsePayload)

    if (responsePayload.entitlementId) {
      const third = await fetch(`${baseUrl}${route}`, {
        method: 'GET',
        headers: {
          'x-agent-entitlement': responsePayload.entitlementId
        }
      })
      const thirdText = await third.text()
      console.log(`entitlement-only status=${third.status}`)
      console.log(thirdText.slice(0, 300))
      return
    }
  }

  console.log(secondText.slice(0, 300))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

