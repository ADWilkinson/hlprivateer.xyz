import { describe, expect, it } from 'vitest'
import { ApiStore } from './store'
import { PublicPnlResponseSchema, PublicSnapshotSchema } from '@hl/privateer-contracts'

describe('public payload redaction', () => {
  it('exposes pnl payload with public fields only', () => {
    const store = new ApiStore('')
    store.setSnapshot({
      mode: 'READY',
      pnlPct: 1.234,
      driftState: 'IN_TOLERANCE',
      healthCode: 'GREEN',
      lastUpdateAt: new Date().toISOString()
    })

    const pnl = store.getPublicPnl()
    const snapshot = store.getPublicSnapshot()

    expect(() => PublicPnlResponseSchema.parse(pnl)).not.toThrow()
    expect(() => PublicSnapshotSchema.parse(snapshot)).not.toThrow()
    expect(Object.prototype.hasOwnProperty.call(snapshot as Record<string, unknown>, 'positions')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(snapshot as Record<string, unknown>, 'orders')).toBe(false)
  })
})
