# outcome-engine

Pure, deterministic math for sentiment-driven outcome-market trading. No I/O,
no clock except what callers pass in. Every export is a function of its inputs.

## Exports

- `aggregateSentiment(signals, opts) -> AggregatedSentiment` — weights
  per-signal polarity by `confidence × freshnessDecay × sourceTrust`.
- `estimateProbability({ marketYesPrice, sentiment, prior? }) -> ProbabilityEstimate`
  — Bayesian-style update from market price prior toward sentiment evidence.
- `computeEdge({ pHat, marketYesPrice, side }) -> { edge, edgeBps }`.
- `kellyFraction({ pHat, marketYesPrice, side, kellyCap }) -> number ∈ [0,1]`.
- `proposeOrder({ market, estimate, riskConfig, openExposureUsd }) -> OutcomeProposal | null`
  — combines edge + Kelly + per-market cap into a structured order intent.
