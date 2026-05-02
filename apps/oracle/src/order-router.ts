import { ulid } from 'ulid'
import type { OutcomeFill, OutcomeProposal } from '@hl/privateer-contracts'

/**
 * Translates an ALLOW'd `OutcomeProposal` into an exchange order and observes
 * the fill. Pluggable so DRY_RUN mode can simulate without touching HL.
 */
export interface OrderRouter {
  place(proposal: OutcomeProposal): Promise<OutcomeFill>
}

export class DryRunRouter implements OrderRouter {
  async place(proposal: OutcomeProposal): Promise<OutcomeFill> {
    // Assume immediate fill at the limit price. Realistic enough for the
    // scaffold; production swaps for HyperliquidRouter.
    return {
      id: `f-${ulid()}`,
      proposalId: proposal.id,
      marketId: proposal.marketId,
      side: proposal.side,
      fillPrice: proposal.limitPrice,
      fillSizeUsd: proposal.sizeUsd,
      feeUsd: 0, // HIP-4: no fee on open
      ts: new Date().toISOString()
    }
  }
}

/**
 * HIP-4 outcome-market router. Stub today — `@nktkas/hyperliquid` 0.31.0
 * does not yet surface outcome-market order types. The shape is here so the
 * orchestrator wiring is final; only `place()` needs filling in.
 */
export class HyperliquidOrderRouter implements OrderRouter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly transport: unknown) {}

  async place(_proposal: OutcomeProposal): Promise<OutcomeFill> {
    throw new Error('HyperliquidOrderRouter.place: HIP-4 endpoint not yet wired in @nktkas/hyperliquid 0.31.0')
  }
}
