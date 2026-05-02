import { z } from 'zod'

const Erc8004RegistrationSchema = z.object({
  type: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string().url().optional(),
  services: z.array(z.object({
    name: z.string(),
    endpoint: z.string().url(),
    version: z.string().optional(),
  })),
  x402Support: z.boolean().optional(),
  active: z.boolean(),
  registrations: z.array(z.object({
    agentId: z.number(),
    agentRegistry: z.string(),
  })),
  supportedTrust: z.array(z.string()).optional(),
})

type Erc8004Registration = z.infer<typeof Erc8004RegistrationSchema>

type SupportedChainId = 8453 | 84532

const IDENTITY_REGISTRY: Record<SupportedChainId, `0x${string}`> = {
  8453: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  84532: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
}

const REPUTATION_REGISTRY: Record<SupportedChainId, `0x${string}`> = {
  8453: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  84532: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
}

const identityReadAbi = [
  {
    type: 'function' as const,
    name: 'ownerOf' as const,
    inputs: [{ name: 'tokenId', type: 'uint256' as const }],
    outputs: [{ name: '', type: 'address' as const }],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'tokenURI' as const,
    inputs: [{ name: 'tokenId', type: 'uint256' as const }],
    outputs: [{ name: '', type: 'string' as const }],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'getAgentWallet' as const,
    inputs: [{ name: 'agentId', type: 'uint256' as const }],
    outputs: [{ name: '', type: 'address' as const }],
    stateMutability: 'view' as const,
  },
] as const

const reputationReadAbi = [
  {
    type: 'function' as const,
    name: 'getSummary' as const,
    inputs: [
      { name: 'agentId', type: 'uint256' as const },
      { name: 'clientAddresses', type: 'address[]' as const },
      { name: 'tag1', type: 'string' as const },
      { name: 'tag2', type: 'string' as const },
    ],
    outputs: [
      { name: 'count', type: 'uint256' as const },
      { name: 'summaryValue', type: 'int256' as const },
      { name: 'summaryValueDecimals', type: 'uint8' as const },
    ],
    stateMutability: 'view' as const,
  },
] as const

export interface DiscoveredAgent {
  agentId: bigint
  owner: string
  agentURI: string
  wallet: string
  registration: Erc8004Registration | null
  reputation: { count: bigint; summaryValue: bigint; summaryValueDecimals: number } | null
}

export async function discoverAgent(params: {
  chainId: SupportedChainId
  rpcUrl: string
  agentId: bigint
}): Promise<DiscoveredAgent> {
  const { createPublicClient, http } = await import('viem')
  const { base, baseSepolia } = await import('viem/chains')

  const chain = params.chainId === 8453 ? base : baseSepolia
  const publicClient = createPublicClient({ chain, transport: http(params.rpcUrl) })
  const identityAddr = IDENTITY_REGISTRY[params.chainId]
  const reputationAddr = REPUTATION_REGISTRY[params.chainId]

  const [owner, agentURI, wallet] = await Promise.all([
    publicClient.readContract({
      address: identityAddr,
      abi: identityReadAbi,
      functionName: 'ownerOf',
      args: [params.agentId],
    }),
    publicClient.readContract({
      address: identityAddr,
      abi: identityReadAbi,
      functionName: 'tokenURI',
      args: [params.agentId],
    }),
    publicClient.readContract({
      address: identityAddr,
      abi: identityReadAbi,
      functionName: 'getAgentWallet',
      args: [params.agentId],
    }),
  ])

  let registration: Erc8004Registration | null = null
  try {
    const res = await fetch(agentURI, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const json = await res.json()
      const parsed = Erc8004RegistrationSchema.safeParse(json)
      if (parsed.success) registration = parsed.data
    }
  } catch {
    // Registration file fetch is best-effort
  }

  let reputation: DiscoveredAgent['reputation'] = null
  try {
    const [count, summaryValue, summaryValueDecimals] = await publicClient.readContract({
      address: reputationAddr,
      abi: reputationReadAbi,
      functionName: 'getSummary',
      args: [params.agentId, [], '', ''],
    })
    reputation = { count, summaryValue, summaryValueDecimals }
  } catch {
    // Reputation read is best-effort
  }

  return { agentId: params.agentId, owner, agentURI, wallet, registration, reputation }
}
