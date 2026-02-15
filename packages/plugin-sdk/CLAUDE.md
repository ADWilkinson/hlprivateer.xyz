# Plugin SDK - Development Context

## Overview
TypeScript SDK defining the contract for external agents/plugins that integrate with HL Privateer via event bus and capability-gated APIs.

## Key Interfaces

**PluginManifest**: `id`, `version`, `compatVersion`, `actorType` (internal/external), `requiredTier`, `capabilities[]`, `permissions[]`, `cooldownMs`.

**PluginRuntime**: `manifest`, `initialize(context)`, `poll(): PluginSignal[]`, `shutdown()`.

**PluginContext**: `pluginId`, `eventBusPublish()`, `getConfig()`, `logger()`.

**PluginSignal**: `pluginId`, `signalType` (funding/correlation/volatility/custom), `symbol`, `value`, `ts`.

## Plugin Loader
`createPluginManager(context)` returns `loadPlugin(path)`, `enablePlugin(id)`, `disablePlugin(id)`, `list()`. Loads via ESM `import()`, validates manifest with Zod, starts poll loop with cooldown. Errors isolated (caught/logged, runtime continues).

## Utilities
- `fetchWithRetry(url, opts)`: Exponential backoff (500ms, 3 retries) for external API calls
- `normalizeFundingRate(raw)`: Hyperliquid funding rate normalization
- `computeFundingDelta(current, baseline)`: Delta vs baseline

## Integration
1. Runtime loads plugin via `loadPlugin('/path/to/plugin.js')`
2. Validates manifest + tier entitlement
3. `initialize(context)` with scoped logger + event bus
4. Poll loop → signals published to `hlp.plugin.signals`
5. Runtime consumes signals in agent loops

## Deps
- `@hl/privateer-contracts`: Event envelope types
- `zod`: Manifest + signal validation
