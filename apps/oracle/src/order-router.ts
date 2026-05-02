import { ulid } from 'ulid'
import type { OutcomeFill, OutcomeProposal } from '@hl/privateer-contracts'

export interface OrderRouter {
  place(proposal: OutcomeProposal): Promise<OutcomeFill>
}

export class DryRunRouter implements OrderRouter {
  async place(proposal: OutcomeProposal): Promise<OutcomeFill> {
    return {
      id: `f-${ulid()}`,
      proposalId: proposal.id,
      marketId: proposal.marketId,
      side: proposal.side,
      fillPrice: proposal.limitPrice,
      fillSizeUsd: proposal.sizeUsd,
      feeUsd: 0,
      ts: new Date().toISOString()
    }
  }
}
