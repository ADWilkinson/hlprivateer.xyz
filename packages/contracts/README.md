# contracts

Zod schemas + TypeScript types shared across services. Single source of
truth for cross-service messages.

## Schemas

- **Bus**: `EventEnvelopeSchema`, `StreamNameSchema` (the `hlpv2.*` namespace),
  `ActorTypeSchema`, `RuntimeModeSchema`.
- **Markets**: `OutcomeMarketSchema`, `MarketStatusSchema`, `Probability`.
- **Sentiment**: `SentimentSourceSchema`, `SentimentSignalSchema`.
- **Estimation**: `ProbabilityEstimateSchema`.
- **Execution**: `OutcomeProposalSchema`, `OutcomeSideSchema`,
  `OutcomeFillSchema`.
- **Risk**: `RiskGateCodeSchema` (14 gates), `RiskGateFailureSchema`,
  `RiskDecisionSchema`, `RiskConfigSchema`.
- **Strategy**: `StrategyConfigSchema` (`risk` + `prompts.sentimentScorer`
  + `sources.trust` + `estimation` + `marketFilter`).
- **Floor**: `PublicMarketSchema`, `FloorTapeLineSchema`, `FloorSnapshotSchema`.

Every schema has safe Zod defaults where possible so partial config files
parse cleanly.

v1 (perp) contracts are frozen at `legacy/packages/contracts-v1/`.
