import { createHash } from 'node:crypto'
import type { EventBus } from '@hl/privateer-event-bus'

export interface AuditEntry {
  type: string
  correlationId: string
  payload: unknown
}

/**
 * Hash-chained audit appender. Each new entry stores `prevHash = sha256(prev
 * canonical envelope payload)`; replay can re-walk and detect tamper.
 *
 * Ports the v1 pattern with a smaller surface — no separate signer, no
 * Postgres archive. Audit retention is the bus's `hlpv2.audit` MAXLEN=0 (never
 * trimmed).
 */
export class AuditChain {
  private prevHash: string = '0'.repeat(64)

  constructor(private readonly bus: EventBus, private readonly source: string) {}

  async append(entry: AuditEntry): Promise<string> {
    const ts = new Date().toISOString()
    const body = {
      type: entry.type,
      ts,
      prevHash: this.prevHash,
      payload: entry.payload
    }
    const hash = sha256(canonicalize(body))
    await this.bus.publish('hlpv2.audit', {
      type: entry.type,
      stream: 'hlpv2.audit',
      source: this.source,
      correlationId: entry.correlationId,
      actorType: 'system',
      actorId: 'audit',
      payload: { ...body, hash }
    })
    this.prevHash = hash
    return hash
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k]
      return sorted
    }
    return v
  })
}
