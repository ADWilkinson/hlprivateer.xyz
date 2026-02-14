# skills.md - Internal + External Agent Skill Contracts

## 1. Internal agent skills

### 1.1 floor-agent-runner (implemented)
Purpose: Propose delta-to-target pair trades and publish public "floor tape" + structured analysis.
Inputs:
- Normalized ticks (`hlp.market.normalized`)
- Plugin signals (`hlp.plugin.signals`)
- Current positions/mode (from `hlp.ui.events`)
Outputs:
- `StrategyProposal` events to `hlp.strategy.proposals`
- `FLOOR_TAPE` lines to `hlp.ui.events` (roles: `scout`, `research`, `strategist`, `execution`, `risk`, `scribe`, `ops`)
- Audit analysis records to `hlp.audit.events`
Forbidden:
- No direct order placement (runtime executes only after risk approval)
- No config mutation
- No secret access (must operate on provided context only)

### 1.2 research-agent (implemented)
Purpose: Generate regime hypotheses and strategist guidance (non-executing).
Outputs:
- `FLOOR_TAPE` lines (role: `research`)
- `hlp.audit.events` entries (action: `research.report`)
Forbidden:
- No direct order placement
- No config mutation

### 1.3 risk-agent (implemented)
Purpose: Explain risk posture (non-authoritative; runtime risk engine is source of truth).
Inputs:
- Current exposure
- Candidate proposals
Outputs:
- `FLOOR_TAPE` lines (role: `risk`)
- `hlp.audit.events` entries (action: `risk.report`)
Forbidden:
- No override of risk decisions

### 1.4 execution-agent (implemented)
Purpose: Suggest execution tactics under constraints and annotate proposals with slippage expectations.
Inputs:
- Allowed proposals
- Orderbook state
Outputs:
- Adjusted `expectedSlippageBps`/`maxSlippageBps` in emitted `StrategyProposal`
- `FLOOR_TAPE` lines (role: `execution`)
Forbidden:
- No bypass of OMS/risk gate

### 1.5 ops-agent (implemented)
Purpose: Detect feed staleness and service posture.
Inputs:
- Logs, traces, metrics, service state
Outputs:
- `FLOOR_TAPE` lines (role: `ops`)
- Optional `/halt` publication to `hlp.commands` when `OPS_AUTO_HALT=true` (fail-safe only)
Forbidden:
- No secret access beyond required diagnostics

## 2. External agent skills

### 2.1 subscriber-agent
Tier: 0+
Capabilities:
- `stream.read.public`
- `command.status`

### 2.2 premium-agent
Tier: 1+
Capabilities:
- `stream.read.public`
- `stream.read.obfuscated.realtime`
- `command.status`
- `command.explain.redacted`
- `analysis.read`

### 2.3 integration-agent
Tier: 2+ and whitelist
Capabilities:
- `plugin.submit`
- `plugin.health.read`
- `market.data.read`
- `agent.insights.read`
- `copy.positions.read`
- `copy.signals.read`
- `analysis.read`
- `command.positions`

## 3. Shared schemas

```ts
import { z } from "zod";

export const StrategyProposalSchema = z.object({
  proposalId: z.string().min(1),
  cycleId: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  createdBy: z.string().min(1),
  requestedMode: z.enum(["SIM", "LIVE"]).default("SIM"),
  actions: z.array(
    z.object({
      type: z.enum(["ENTER", "EXIT", "REBALANCE", "HOLD"]),
      rationale: z.string().min(3),
      notionalUsd: z.number().positive(),
      expectedSlippageBps: z.number().nonnegative().default(0),
      maxSlippageBps: z.number().nonnegative().optional(),
      legs: z.array(
        z.object({
          symbol: z.string().min(1),
          side: z.enum(["BUY", "SELL"]),
          notionalUsd: z.number().positive(),
          targetRatio: z.number().min(0).max(1).optional()
        }).strict()
      ).min(1)
    }).strict()
  ).min(1)
});

export const AgentHandshakeSchema = z.object({
  type: z.literal("agent.hello"),
  agentId: z.string(),
  agentVersion: z.string(),
  capabilities: z.array(z.string()),
  requestedTier: z.enum(["tier0", "tier1", "tier2", "tier3"]),
  proof: z.string()
});
```

## 4. Skill registration contract

```ts
export interface SkillManifest {
  id: string;
  version: string;
  actorType: "internal" | "external";
  requiredTier?: "tier0" | "tier1" | "tier2" | "tier3";
  capabilities: string[];
  inputSchemaRef: string;
  outputSchemaRef: string;
  permissionScopes: string[];
}
```

## 5. Enforcement rules
- All skill outputs are untrusted until schema-validated.
- Skills cannot request secret values directly.
- Skills cannot escalate capability scope at runtime.
- Payment entitlement is checked before every external skill invocation.
