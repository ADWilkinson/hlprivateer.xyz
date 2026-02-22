# WebSocket Gateway - Development Context

## Overview
WebSocket server providing real-time event fanout to operators, agents, and public subscribers. Consumes Redis Streams and broadcasts to authenticated clients with channel-based subscriptions.

## Key Files
```
src/
├── index.ts       # WS server, auth, subscriptions, command handling
└── telemetry.ts   # OpenTelemetry initialization
```

## Architecture
- **Transport**: Node `http` + `ws` library
- **Auth**: JWT (HS256 inline) or dev tokens (`operator:user`, `agent:id:tier`)
- **Broadcast**: Channel-based fanout (public, operator, agent, audit)
- **Rate Limiting**: 20 commands/10s sliding window per socket
- **Abuse Protection**: 8 failures → 60s ban

## WebSocket Protocol

### Client → Server
```typescript
{ type: 'sub.add', channel: 'operator' }     // Subscribe
{ type: 'sub.remove', channel: 'operator' }   // Unsubscribe
{ type: 'cmd.exec', command: '/status', args: [] }  // Command
{ type: 'ping' }
```

### Server → Client
```typescript
{ type: 'sub.ack', channel: 'operator', accepted: true }
{ type: 'event', channel: 'public', payload: { ... } }
{ type: 'cmd.result', requestId: 'ulid', result: { ok: true } }
{ type: 'error', requestId: 'ulid', code: 'RATE_LIMITED', message: '...' }
{ type: 'pong' }
```

## Channel Authorization
- `public`: everyone (auto-subscribed)
- `operator`: operator only
- `agent`: agent or operator
- `audit`: operator only

## Auth
**JWT**: Verified inline (HS256), claims `{ sub, roles, mfa, iss, aud }`. Dev tokens (`operator:*`, `agent:*:*`) disabled in production.

**Commands**: Validated against `commandPolicy` (actor types, capabilities, roles). MFA enforced for admin commands if `OPERATOR_MFA_REQUIRED=true`.

## Event Bus
**Consumes**: `hlp.ui.events`, `hlp.audit.events`
**Publishes**: `hlp.commands` (operator/agent commands)

## Security Limits
- Message size: 4KB max
- Buffered data: 1MB max
- Token length: 4096 chars
- Channel name: 32 chars

## Metrics
`hlp_ws_connections`, `hlp_ws_command_total`, `hlp_ws_event_total`, `hlp_ws_ban_total`, `hlp_ws_security_events_total`

## Repository Documentation
- `AGENTS.md`: operational runbook and deployment flow.
- `README.md`: repo overview and setup commands.
- `API.md`: endpoint contracts and x402 pricing.
- `docs/SPEC.md`: architecture and behavioral invariants.
- `RUNBOOK.md`: operational recovery and day-to-day runbook.
- `SECURITY.md`: secret handling and threat model.
