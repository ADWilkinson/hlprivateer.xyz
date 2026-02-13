import { createHash } from 'node:crypto'
import { AuditEvent, Entitlement, OperatorOrder, OperatorPosition, PublicSnapshot, PublicPnlResponse, TradeState } from '@hl/privateer-contracts'

export interface ApiRuntimeSnapshot {
  mode: TradeState
  pnlPct: number
  lastUpdateAt: string
  healthCode: 'GREEN' | 'YELLOW' | 'RED'
}

const defaultSnapshot: ApiRuntimeSnapshot = {
  mode: 'INIT',
  pnlPct: 0,
  lastUpdateAt: new Date().toISOString(),
  healthCode: 'GREEN'
}

export class ApiStore {
  public snapshot: ApiSnapshot = {
    mode: 'INIT',
    pnlPct: 0,
    healthCode: 'GREEN',
    driftState: 'IN_TOLERANCE',
    lastUpdateAt: new Date().toISOString()
  }
  public positions: OperatorPosition[] = []
  public orders: OperatorOrder[] = []
  public audits: AuditEvent[] = []
  public entitlements = new Map<string, Entitlement>()
  public abuses = new Map<string, number>()
  private auditTailHash = createHash('sha256').update('hlprivateer-audit-genesis').digest('hex')

  public getPublicPnl(): PublicPnlResponse {
    return {
      pnlPct: this.snapshot.pnlPct,
      mode: this.snapshot.mode,
      updatedAt: this.snapshot.lastUpdateAt
    }
  }

  public getPublicSnapshot(): PublicSnapshot {
    return this.snapshot
  }

  public setSnapshot(snapshot: Partial<ApiSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...snapshot,
      lastUpdateAt: snapshot.lastUpdateAt ?? new Date().toISOString()
    }
  }

  public setPositions(positions: OperatorPosition[]) {
    this.positions = positions
  }

  public setOrders(orders: OperatorOrder[]) {
    this.orders = orders
  }

  public addAudit(event: AuditEvent) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          previousHash: this.auditTailHash,
          eventId: event.id,
          actorType: event.actorType,
          actorId: event.actorId,
          action: event.action,
          resource: event.resource,
          correlationId: event.correlationId,
          details: event.details
        })
      )
      .digest('hex')

    const eventWithHash: AuditEvent = {
      ...event,
      hash,
      details: {
        ...event.details,
        previousHash: this.auditTailHash
      }
    }

    this.auditTailHash = hash
    this.audits.unshift(eventWithHash)
    this.audits = this.audits.slice(0, 5000)
  }

  public getAudit(limit: number, cursor?: number): AuditEvent[] {
    const offset = cursor ?? 0
    return this.audits.slice(offset, offset + limit)
  }
}

interface ApiSnapshot extends PublicSnapshot {}
