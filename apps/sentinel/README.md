# sentinel

Polls `SentimentSource` adapters, scores each item, publishes `SentimentSignal`
envelopes onto `hlpv2.sentiment`.

## Run

```bash
bun run dev
SENTINEL_REDIS_URL=redis://...      # opt-in Redis (default: in-memory bus)
SENTINEL_INTERVAL_MS=30000
SENTINEL_FIXTURE=path/to/items.json
```

Fixture item shape:

```json
{
  "marketId": "mkt-1",
  "source": "news",
  "summary": "Positive macro print, …",
  "url": "https://example.com/x",
  "observedAt": "2026-04-30T12:00:00Z"
}
```

## Strategy

The LLM system prompt for `LlmScorer` is read from `strategy.prompts.sentimentScorer`
in `config/strategy.json` (gitignored — see root README). The default scorer
in `main.ts` is the deterministic `HeuristicScorer`; wire `resolveCompleter()`
to your LLM of choice to use the prompt.
