export const IDENTITY_REGISTRY_BASE = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
export const REPUTATION_REGISTRY_BASE = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'
export const BASE_CHAIN_ID = 8453

export function basescanUrl(type: 'address' | 'tx' | 'token', value: string): string {
  return `https://basescan.org/${type}/${value}`
}

export function basescanNftUrl(contractAddress: string, tokenId: number | string): string {
  return `https://basescan.org/nft/${contractAddress}/${tokenId}`
}

export interface IdentityResponse {
  erc8004: {
    chainId: number
    agentId: number
    identityRegistry: string
    reputationRegistry: string
    registrationFile: string
  } | null
  reputation: {
    count: number
    summaryValue: number
    summaryValueDecimals: number
  } | null
}
