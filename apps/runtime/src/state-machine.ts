import { TradeState, TradeStateSchema } from '@hl/privateer-contracts'

export type RuntimeState = {
  state: TradeState
  reason: string
  updatedAt: string
}

const transitions: Record<TradeState, TradeState[]> = {
  INIT: ['WARMUP'],
  WARMUP: ['READY', 'HALT', 'SAFE_MODE'],
  READY: ['IN_TRADE', 'HALT', 'SAFE_MODE'],
  IN_TRADE: ['REBALANCE', 'HALT', 'SAFE_MODE'],
  REBALANCE: ['READY', 'HALT', 'SAFE_MODE'],
  HALT: ['READY'],
  SAFE_MODE: ['READY', 'IN_TRADE', 'HALT']
}

export const initialState = (): RuntimeState => ({
  state: 'INIT',
  reason: 'startup',
  updatedAt: new Date().toISOString()
})

export function canTransition(current: TradeState, next: TradeState): boolean {
  TradeStateSchema.parse(current)
  TradeStateSchema.parse(next)
  return transitions[current]?.includes(next) ?? false
}

export function transition(current: RuntimeState, next: TradeState, reason: string): RuntimeState {
  if (!canTransition(current.state, next)) {
    throw new Error(`invalid transition ${current.state} -> ${next}`)
  }

  return {
    state: next,
    reason,
    updatedAt: new Date().toISOString()
  }
}
