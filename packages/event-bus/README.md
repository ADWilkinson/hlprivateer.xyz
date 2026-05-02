# event-bus

Typed pub/sub over the `hlpv2.*` stream namespace. Two implementations
behind a single `EventBus` interface: `RedisEventBus` for production and
`InMemoryEventBus` for tests.

## Streams (in `StreamNameSchema`)

| Stream                | MAXLEN  | Notes                                 |
|-----------------------|---------|---------------------------------------|
| `hlpv2.markets`       | 10 000  | Market discovery + state changes      |
| `hlpv2.sentiment`     | 50 000  | Bursty                                |
| `hlpv2.estimates`     | 10 000  |                                       |
| `hlpv2.proposals`     | 10 000  |                                       |
| `hlpv2.decisions`     | 10 000  |                                       |
| `hlpv2.fills`         | 100 000 | Months of history                     |
| `hlpv2.audit`         | 0       | Never trimmed (operator compliance)   |
| `hlpv2.ui`            | 50 000  | Bursty                                |
| `hlpv2.commands`      | 10 000  |                                       |

## EventEnvelope

Every event carries a typed envelope: `id`, `stream`, `type`, `ts`,
`source`, `correlationId`, `causationId?`, `actorType`, `actorId`,
`payload`, `signature?`, `riskMode?`. Validated by Zod on publish and
parse.

## Replay

`bus.replay(stream, fromTs, toTs, onMessage)` walks the stream in time
order — used by audit tooling.
