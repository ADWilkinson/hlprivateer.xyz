# sentinel

The sentiment ingestion service. Polls a configurable set of `SentimentSource`
adapters, scores each item with an LLM, and publishes `SentimentSignal`
envelopes onto `hlpv2.sentiment`.

## Architecture

```
+----------------+     poll     +-------------+     score     +-------------+
| Source adapter |  --tick-->   | Sentinel    |  --batch-->   | LLM scorer  |
| (rss/x/poly..) |              | scheduler   |               | (stubbable) |
+----------------+              +------+------+               +------+------+
                                       |                              |
                                       |              SentimentSignal |
                                       v                              v
                          hlpv2.sentiment  ◄─── publish ─── EventEnvelope
```

- **Source adapters** are pluggable; each yields raw items tagged by
  market id. The reference impl is a fixture/file-based source for dev mode.
- **The scorer** is an interface; the default is a deterministic heuristic
  scorer for tests; production wires Claude/Codex via an SDK adapter.
- **Output** is one `SentimentSignal` per item, validated against the Zod
  schema in `@hl/privateer-contracts`.

## Run

```bash
bun run dev               # in-memory bus, fixture source, heuristic scorer
SENTINEL_REDIS_URL=...    # opt-in Redis transport
SENTINEL_INTERVAL_MS=30000
SENTINEL_FIXTURE=path/to/items.json
```

`items.json` shape:

```json
[
  {
    "marketId": "mkt-1",
    "source": "news",
    "summary": "Positive macro print, …",
    "url": "https://example.com/x",
    "observedAt": "2026-04-30T12:00:00Z"
  }
]
```
