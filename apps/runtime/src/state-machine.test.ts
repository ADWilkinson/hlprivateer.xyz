import { describe, expect, it } from 'vitest'
import { canTransition, initialState, transition } from './state-machine'

describe('runtime state machine', () => {
  it('allows configured warmup transition from INIT', () => {
    expect(canTransition('INIT', 'WARMUP')).toBe(true)
  })

  it('rejects invalid transitions', () => {
    expect(() => transition({ state: 'INIT', reason: 'start', updatedAt: new Date().toISOString() }, 'READY', 'invalid')).toThrowError()
  })

  it('updates state metadata on transition', () => {
    const baseline = initialState()
    const transitioned = transition(baseline, 'WARMUP', 'initialization complete')
    expect(transitioned.state).toBe('WARMUP')
    expect(transitioned.reason).toBe('initialization complete')
  })
})
