# outcome-engine

Pure, deterministic math. No I/O. No implicit clock — callers pass `nowMs`
where it matters. Every export is a function of its inputs.

## Exports

- `aggregateSentiment(signals, opts)` — weights signals by
  `confidence × freshness-decay × source-trust`. Decay is computed from each
  signal's `ts` at evaluation time so signals don't "freeze" in the buffer.
  Returns `{ polarity, confidence, evidenceMass, basisSignalIds }`.
- `signalAgeSec(signal, nowMs)` — exported helper used by the gate too.
- `estimateProbability({ marketYesPrice, sentiment, prior?, evidenceWeight? })`
  — Bayesian-style update from the market price toward sentiment evidence.
- `computeEdge({ pHat, marketYesPrice, side })` → `{ edge, edgeBps }`.
- `kellyFraction({ pHat, marketYesPrice, side, kellyCap? })` — binary Kelly
  capped at `kellyCap` (default 0.25). `f* = (q - p) / (1 - p)`.
- `proposeOrder({ market, estimate, riskConfig, openExposureUsd })` →
  `OutcomeProposal | null`. Combines edge + Kelly + per-market and
  bankroll caps.
- `DEFAULT_SOURCE_TRUST` — per-source priors (overridable).

21 vitest cases cover the math.
