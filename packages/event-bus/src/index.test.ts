import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from './index'

describe('event-bus', () => {
  it('publishes and replays messages in memory', async () => {
    const bus = new InMemoryEventBus()

    const envelopeId = await bus.publish('hlpv2.markets', {
      type: 'market.snapshot',
      stream: 'hlpv2.markets',
      source: 'test',
      correlationId: 'test-correlation',
      actorType: 'system',
      actorId: 'tester',
      payload: { id: 'mkt-1', yesPrice: 0.42 }
    })

    const batch = await bus.readBatch('hlpv2.markets', '0-0', 10)
    expect(batch).toHaveLength(1)
    expect(batch[0].envelope.id).toBe(envelopeId)
    expect(batch[0].envelope.payload).toMatchObject({ id: 'mkt-1' })

    const replayed: string[] = []
    await bus.replay(
      'hlpv2.markets',
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
      (event) => {
        replayed.push(event.id)
      }
    )

    expect(replayed).toContain(envelopeId)
  })

  it('stops replay when callback returns false', async () => {
    const bus = new InMemoryEventBus()
    const now = Date.now()

    await bus.publish('hlpv2.audit', {
      type: 'audit.command',
      stream: 'hlpv2.audit',
      source: 'test',
      correlationId: 'replay-stop-1',
      actorType: 'system',
      actorId: 'tester',
      payload: { step: 1 },
      ts: new Date(now - 1000).toISOString()
    })
    await bus.publish('hlpv2.audit', {
      type: 'audit.command',
      stream: 'hlpv2.audit',
      source: 'test',
      correlationId: 'replay-stop-2',
      actorType: 'system',
      actorId: 'tester',
      payload: { step: 2 },
      ts: new Date(now).toISOString()
    })

    let count = 0
    await bus.replay(
      'hlpv2.audit',
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
