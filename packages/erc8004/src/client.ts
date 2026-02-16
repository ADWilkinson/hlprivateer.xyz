import { createPublicClient, createWalletClient, http, type Account, type Hex, type Chain } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { type SupportedChainId, IDENTITY_REGISTRY, REPUTATION_REGISTRY } from './addresses'
import { identityRegistryAbi, reputationRegistryAbi } from './abis'

export interface Erc8004ClientConfig {
  chainId: SupportedChainId
  rpcUrl: string
}

function chainForId(chainId: SupportedChainId): Chain {
  return chainId === 8453 ? base : baseSepolia
}

export function createIdentityClient(config: Erc8004ClientConfig) {
  const chain = chainForId(config.chainId)
  const transport = http(config.rpcUrl)
  const publicClient = createPublicClient({ chain, transport })
  const registryAddress = IDENTITY_REGISTRY[config.chainId]

  return {
    async register(agentURI: string, account: Account) {
      const walletClient = createWalletClient({ chain, transport, account })
      const txHash = await walletClient.writeContract({
        address: registryAddress,
        abi: identityRegistryAbi,
        functionName: 'register',
        args: [agentURI],
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      const event = receipt.logs.find(log => log.address.toLowerCase() === registryAddress.toLowerCase())
      const agentId = event?.topics[1] ? BigInt(event.topics[1]) : 0n
      return { agentId, txHash }
    },

    async setAgentURI(agentId: bigint, newURI: string, account: Account) {
      const walletClient = createWalletClient({ chain, transport, account })
      return walletClient.writeContract({
        address: registryAddress,
        abi: identityRegistryAbi,
        functionName: 'setAgentURI',
        args: [agentId, newURI],
      })
    },

    async setAgentWallet(agentId: bigint, newWallet: Hex, deadline: bigint, signature: Hex, account: Account) {
      const walletClient = createWalletClient({ chain, transport, account })
      return walletClient.writeContract({
        address: registryAddress,
        abi: identityRegistryAbi,
        functionName: 'setAgentWallet',
        args: [agentId, newWallet, deadline, signature],
      })
    },

    async getAgentWallet(agentId: bigint) {
      return publicClient.readContract({
        address: registryAddress,
        abi: identityRegistryAbi,
        functionName: 'getAgentWallet',
        args: [agentId],
      })
    },

    async ownerOf(agentId: bigint) {
      return publicClient.readContract({
        address: registryAddress,
        abi: identityRegistryAbi,
        functionName: 'ownerOf',
        args: [agentId],
      })
    },

    async tokenURI(agentId: bigint) {
      return publicClient.readContract({
        address: registryAddress,
        abi: identityRegistryAbi,
        functionName: 'tokenURI',
        args: [agentId],
      })
    },

    async setMetadata(agentId: bigint, key: string, value: Hex, account: Account) {
      const walletClient = createWalletClient({ chain, transport, account })
      return walletClient.writeContract({
        address: registryAddress,
        abi: identityRegistryAbi,
        functionName: 'setMetadata',
        args: [agentId, key, value],
      })
    },

    async getMetadata(agentId: bigint, key: string) {
      return publicClient.readContract({
        address: registryAddress,
        abi: identityRegistryAbi,
        functionName: 'getMetadata',
        args: [agentId, key],
      })
    },
  }
}

export function createReputationClient(config: Erc8004ClientConfig) {
  const chain = chainForId(config.chainId)
  const transport = http(config.rpcUrl)
  const publicClient = createPublicClient({ chain, transport })
  const registryAddress = REPUTATION_REGISTRY[config.chainId]

  return {
    async giveFeedback(
      params: {
        agentId: bigint
        value: number
        valueDecimals: number
        tag1: string
        tag2: string
        endpoint: string
        message: string
        extraData: Hex
      },
      account: Account,
    ) {
      const walletClient = createWalletClient({ chain, transport, account })
      return walletClient.writeContract({
        address: registryAddress,
        abi: reputationRegistryAbi,
        functionName: 'giveFeedback',
        args: [
          params.agentId,
          BigInt(params.value),
          params.valueDecimals,
          params.tag1,
          params.tag2,
          params.endpoint,
          params.message,
          params.extraData,
        ],
      })
    },

    async getSummary(agentId: bigint, clientAddresses: Hex[], tag1: string, tag2: string) {
      const [count, summaryValue, summaryValueDecimals] = await publicClient.readContract({
        address: registryAddress,
        abi: reputationRegistryAbi,
        functionName: 'getSummary',
        args: [agentId, clientAddresses, tag1, tag2],
      })
      return { count, summaryValue, summaryValueDecimals }
    },

    async getClients(agentId: bigint) {
      return publicClient.readContract({
        address: registryAddress,
        abi: reputationRegistryAbi,
        functionName: 'getClients',
        args: [agentId],
      })
    },
  }
}
