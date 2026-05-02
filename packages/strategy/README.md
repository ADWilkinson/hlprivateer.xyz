# strategy

Loader for the swappable strategy config. Resolves the path the same way
both apps do, so a single private `config/strategy.json` drives both.

Resolution order (first hit wins):

1. `STRATEGY_CONFIG_PATH` env var
2. `config/strategy.json` (gitignored)
3. `config/strategy.template.json` (committed default)
4. Empty object → all schema defaults

A `StrategyConfig` is always returned. Missing fields fall back to the Zod
defaults baked into `StrategyConfigSchema`.
