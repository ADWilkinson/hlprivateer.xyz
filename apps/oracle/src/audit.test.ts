import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '@hl/privateer-event-bus'
import { AuditChain, canonicalize } from './audit'

describe('AuditChain', () => {
  it('chains hashes across entries', async () => {
    const bus = new InMemoryEventBus()
    const audit = new AuditChain(bus, 'test')
    const h1 = await audit.append({ type: 't', correlationId: 'c-1', payload: { x: 1 } })
    const h2 = await audit.append({ type: 't', correlationId: 'c-2', payload: { x: 2 } })
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).not.toBe(h2)
    const batch = await bus.readBatch('hlpv2.audit', '0-0', 10)
    expect(batch).toHaveLength(2)
    const second = batch[1].envelope.payload as { prevHash: string; hash: string }
    expect(second.prevHash).toBe(h1)
    expect(second.hash).toBe(h2)
  })

  it('canonicalizes objects deterministically', () => {
    const a = canonicalize({ b: 1, a: 2 })
    const b = canonicalize({ a: 2, b: 1 })
    expect(a).toBe(b)
  })
})
