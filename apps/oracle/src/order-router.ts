import type { OutcomeFill, OutcomeProposal } from '@hl/privateer-contracts'

// Concrete implementation lands when @nktkas/hyperliquid surfaces HIP-4
// order types. Until then the operator wires their own; main.ts refuses to
// start without one.
export interface OrderRouter {
  place(proposal: OutcomeProposal): Promise<OutcomeFill>
}
