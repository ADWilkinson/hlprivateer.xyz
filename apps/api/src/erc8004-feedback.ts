import { createPublicClient, createWalletClient, http, parseEther, type Hex, type Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import type { FastifyBaseLogger } from 'fastify'

type SupportedChainId = 8453 | 84532

const REPUTATION_REGISTRY: Record<SupportedChainId, Hex> = {
  8453: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  84532: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
}

const reputationGiveFeedbackAbi = [
  {
    type: 'function' as const,
    name: 'giveFeedback' as const,
    inputs: [
      { name: 'agentId', type: 'uint256' as const },
      { name: 'value', type: 'int128' as const },
      { name: 'valueDecimals', type: 'uint8' as const },
      { name: 'tag1', type: 'string' as const },
      { name: 'tag2', type: 'string' as const },
      { name: 'endpoint', type: 'string' as const },
      { name: 'message', type: 'string' as const },
      { name: 'extraData', type: 'bytes32' as const },
    ],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
] as const

const ZERO_BYTES32: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
const LOW_ETH_THRESHOLD = parseEther('0.01')

interface PendingFeedback {
  route: string
  paidAmountUsd: number
  ts: number
}

function chainForId(chainId: SupportedChainId): Chain {
  return chainId === 8453 ? base : baseSepolia
}

function mostCommonRoute(items: PendingFeedback[]): string {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item.route, (counts.get(item.route) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [route, count] of counts) {
    if (count > bestCount) {
      best = route
      bestCount = count
    }
  }
  return best || 'unknown'
}

export interface Erc8004FeedbackConfig {
  chainId: SupportedChainId
  agentId: bigint
  rpcUrl: string
  privateKey: Hex
  batchIntervalMs?: number
  logger: FastifyBaseLogger
}

export class Erc8004FeedbackService {
  private pending: PendingFeedback[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly config: Required<Omit<Erc8004FeedbackConfig, 'logger'>> & { logger: FastifyBaseLogger }

  constructor(config: Erc8004FeedbackConfig) {
    this.config = {
      ...config,
      batchIntervalMs: config.batchIntervalMs ?? 60_000,
    }
    this.timer = setInterval(() => void this.flush(), this.config.batchIntervalMs)
    void this.checkBalance()
  }

  recordSettlement(route: string, paidAmountUsd: number): void {
    this.pending.push({ route, paidAmountUsd, ts: Date.now() })
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.flush()
  }

  private async flush(): Promise<void> {
    if (this.pending.length === 0) return

    const batch = this.pending.splice(0, this.pending.length)
    const tag2 = mostCommonRoute(batch)

    try {
      const chain = chainForId(this.config.chainId)
      const transport = http(this.config.rpcUrl)
      const account = privateKeyToAccount(this.config.privateKey)
      const walletClient = createWalletClient({ chain, transport, account })

      const txHash = await walletClient.writeContract({
        address: REPUTATION_REGISTRY[this.config.chainId],
        abi: reputationGiveFeedbackAbi,
        functionName: 'giveFeedback',
        args: [
          this.config.agentId,
          1n,
          0,
          'x402-settled',
          tag2,
          'https://api.hlprivateer.xyz',
          `${batch.length} settlements`,
          ZERO_BYTES32,
        ],
      })

      this.config.logger.info({ txHash, batchSize: batch.length, tag2 }, 'erc8004 feedback submitted')
    } catch (err) {
      this.config.logger.error({ err, batchSize: batch.length }, 'erc8004 feedback tx failed')
      this.pending.unshift(...batch)
    }
  }

  private async checkBalance(): Promise<void> {
    try {
      const chain = chainForId(this.config.chainId)
      const transport = http(this.config.rpcUrl)
      const account = privateKeyToAccount(this.config.privateKey)
      const publicClient = createPublicClient({ chain, transport })
      const balance = await publicClient.getBalance({ address: account.address })

      if (balance < LOW_ETH_THRESHOLD) {
        this.config.logger.warn(
          { address: account.address, balanceWei: balance.toString() },
          'erc8004 feedback wallet ETH balance low (< 0.01 ETH)'
        )
      }
    } catch (err) {
      this.config.logger.warn({ err }, 'erc8004 balance check failed')
    }
  }
}
