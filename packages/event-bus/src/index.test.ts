import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from './index'

describe('event-bus', () => {
  it('publishes and replays messages in memory', async () => {
    const bus = new InMemoryEventBus()

    const envelopeId = await bus.publish('hlp.market.normalized', {
      type: 'MARKET_TICK',
      stream: 'hlp.market.normalized',
      source: 'test',
      correlationId: 'test-correlation',
      actorType: 'system',
      actorId: 'tester',
      payload: { symbol: 'HYPE' }
    })

    const batch = await bus.readBatch('hlp.market.normalized', '0-0', 10)
    expect(batch).toHaveLength(1)
    expect(batch[0].envelope.id).toBe(envelopeId)
    expect(batch[0].envelope.payload).toMatchObject({ symbol: 'HYPE' })

    const replayed: string[] = []
    await bus.replay('hlp.market.normalized', new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 60_000).toISOString(), (event) => {
      replayed.push(event.id)
    })

    expect(replayed).toContain(envelopeId)
  })
})
