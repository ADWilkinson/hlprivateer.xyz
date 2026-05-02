import { describe, it, expect } from 'vitest'
import { IDENTITY_REGISTRY, REPUTATION_REGISTRY } from './addresses'
import { Erc8004RegistrationSchema, Erc8004FeedbackParamsSchema } from './schemas'

describe('addresses', () => {
  it('has addresses for Base mainnet', () => {
    expect(IDENTITY_REGISTRY[8453]).toMatch(/^0x/)
    expect(REPUTATION_REGISTRY[8453]).toMatch(/^0x/)
  })

  it('has addresses for Base Sepolia', () => {
    expect(IDENTITY_REGISTRY[84532]).toMatch(/^0x/)
    expect(REPUTATION_REGISTRY[84532]).toMatch(/^0x/)
  })
})

describe('Erc8004RegistrationSchema', () => {
  it('validates a complete registration file', () => {
    const valid = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'HL Privateer',
      description: 'Test agent',
      image: 'https://hlprivateer.xyz/icon.svg',
      services: [
        { name: 'web', endpoint: 'https://hlprivateer.xyz' },
        { name: 'x402-api', endpoint: 'https://api.hlprivateer.xyz', version: '1.0.0' },
      ],
      x402Support: true,
      active: true,
      registrations: [
        { agentId: 0, agentRegistry: 'eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
      ],
      supportedTrust: ['reputation'],
    }

    const result = Erc8004RegistrationSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('rejects registration without required fields', () => {
    const result = Erc8004RegistrationSchema.safeParse({ name: 'test' })
    expect(result.success).toBe(false)
  })
})

describe('Erc8004FeedbackParamsSchema', () => {
  it('validates feedback params', () => {
    const result = Erc8004FeedbackParamsSchema.safeParse({
      agentId: 1n,
      value: 1,
      valueDecimals: 0,
      tag1: 'x402-settled',
      tag2: '/v1/agent/positions',
      endpoint: 'https://api.hlprivateer.xyz',
      message: '',
      extraData: '0x0000000000000000000000000000000000000000000000000000000000000000',
    })
    expect(result.success).toBe(true)
  })
})
