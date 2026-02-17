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

  it('stops replay when callback returns false', async () => {
    const bus = new InMemoryEventBus()
    const now = Date.now()

    await bus.publish('hlp.audit.events', {
      type: 'COMMAND',
      stream: 'hlp.audit.events',
      source: 'test',
      correlationId: 'replay-stop-1',
      actorType: 'system',
      actorId: 'tester',
      payload: { step: 1 },
      ts: new Date(now - 1000).toISOString()
    })
    await bus.publish('hlp.audit.events', {
      type: 'COMMAND',
      stream: 'hlp.audit.events',
      source: 'test',
      correlationId: 'replay-stop-2',
      actorType: 'system',
      actorId: 'tester',
      payload: { step: 2 },
      ts: new Date(now).toISOString()
    })

    let count = 0
    await bus.replay(
      'hlp.audit.events',
      new Date(now - 10_000).toISOString(),
      new Date(now + 10_000).toISOString(),
      () => {
        count += 1
        return false
      }
    )

    expect(count).toBe(1)
  })
})
