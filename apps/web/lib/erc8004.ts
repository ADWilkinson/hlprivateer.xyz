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
