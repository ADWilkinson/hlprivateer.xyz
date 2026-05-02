# strategy

Loader for the swappable strategy config. Single private
`config/strategy.json` drives both apps (oracle + sentinel).

The strategy is the slice we don't ship publicly: risk knobs, the LLM
system prompt, source-trust priors, estimation parameters, and the market
topic filter. Framework code (gates, orchestrator, schemas, audit) stays
public.

## Resolution order (first hit wins)

1. `STRATEGY_CONFIG_PATH` env var
2. `config/strategy.json` (gitignored)
3. `config/strategy.template.json` (committed default — public)
4. Empty object → all schema defaults

A `StrategyConfig` is always returned. Missing fields fall back to the
Zod defaults baked into `StrategyConfigSchema` in `@hl/privateer-contracts`.

## Shape

```ts
{
  risk: RiskConfig                 // bankroll, caps, edge thresholds, kelly
  prompts: { sentimentScorer? }    // LLM system prompt for LlmScorer
  sources: { trust: Partial<Record<SentimentSource, 0..1>> }
  estimation: { halfLifeSec, evidenceWeight }
  marketFilter: { topicTagAllowlist?, topicTagBlocklist? }
}
```

## Operator workflow

```bash
cp config/strategy.template.json config/strategy.json
$EDITOR config/strategy.json   # gitignored — your real strategy
```

4 vitest cases cover defaults, explicit file load, env override, and
validation rejection.
