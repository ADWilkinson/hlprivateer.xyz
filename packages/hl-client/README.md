# hl-client

Hyperliquid HTTP transport with rate limiting, response caching, and
subprocess-fallback for environments with cert verification quirks. Built
around `@nktkas/hyperliquid`'s `HttpTransport` plus a custom `postInfo`
helper for the info API.

## Exports

- `createHlClient(config)` → `HlClient` (transport + `postInfo` + limiter
  + cache + `destroy`).
- `ThrottledTransport` — wraps any `IRequestTransport` with the rate
  limiter and cache.
- Typed info-endpoint wrappers (`./info`):
  - `clearinghouseState(hl, user)` → positions + margin summary
  - `userFills(hl, user)` → fill history
  - `userFillsByTime(hl, user, startMs)` → filtered fill history
  - `accountValueUsd(state)` helper for cross-margin or flat margin

The orchestrator's `HyperliquidAccountant` is the main consumer of these.

## Cache TTLs

Per-payload-type TTLs (in `cache.ts`): `clearinghouseState` 4 s,
`userFills` 60 s, `l2Book` 2.5 s, `metaAndAssetCtxs` 60 s, etc.
`orderStatus` is never cached.
