# Event Bus - Development Context

## Overview
Redis Streams-based event bus with in-memory fallback. Communication backbone for all inter-service messaging. Events are append-only with correlation IDs for tracing.

## Key Files
```
src/
├── index.ts           # EventBus interface, RedisEventBus, InMemoryEventBus
└── index.test.ts      # Vitest unit tests
```

## Interface
```typescript
interface EventBus {
  publish<T>(stream, event): Promise<string>
  readBatch(stream, fromId, count?): Promise<Array<{ id, envelope }>>
  consume(stream, startId, onMessage): Promise<() => Promise<void>>
  replay(stream, fromTs, toTs, onMessage): Promise<void>
  health(): Promise<{ ok, mode: 'redis' | 'memory', reason? }>
}
```

## Implementations

**RedisEventBus**: `ioredis` client. `XADD`/`XREAD BLOCK 2000`/`XRANGE`. Dedicated reader connection for blocking reads. Returns cleanup function from `consume()`.

**InMemoryEventBus**: `EventEmitter` + `Map<StreamName, Entry[]>` (max 5000/stream). For local dev and testing.

## Event Envelope
```typescript
{
  id: string          // ULID (time-sortable)
  ts: string          // ISO 8601
  stream: StreamName
  type: string
  source: string
  correlationId: string
  causationId?: string
  actorType: ActorType
  actorId: string
  payload: T
  signature?: string
  riskMode?: 'LIVE' | 'SIM'
  sensitive?: boolean
}
```

## Stream Names
`hlp.commands`, `hlp.strategy.proposals`, `hlp.market.normalized`, `hlp.market.watchlist`, `hlp.ui.events`, `hlp.audit.events`, `hlp.execution.fills`, `hlp.execution.commands`, `hlp.risk.decisions`, `hlp.plugin.signals`

## Correlation/Causation
`correlationId` traces full request/response flows. `causationId` points to parent event. Example: proposal → risk decision → execution report all share same `correlationId`.

## Used By
- `apps/runtime`: Main client (publishes state/positions/risk, consumes commands/proposals)
- `apps/api`: Consumes UI events, publishes commands
- `apps/ws-gateway`: Consumes UI/audit events, publishes commands
- `apps/agent-runner`: Publishes proposals, consumes risk decisions
