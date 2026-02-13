# skills.md - Internal + External Agent Skill Contracts

## 1. Internal agent skills

### 1.1 research-agent
Purpose: Generate basket and regime hypotheses.
Inputs:
- Market snapshots
- Funding/correlation/volatility plugin outputs
- Strategy state
Outputs:
- `StrategyProposal` objects only
Forbidden:
- No direct order placement
- No config mutation

### 1.2 risk-agent
Purpose: Explain risk posture and simulate outcomes.
Inputs:
- Current exposure
- Candidate proposals
- Risk config
Outputs:
- `RiskExplanation` and simulation summaries
Forbidden:
- No override of risk decisions

### 1.3 execution-agent
Purpose: Suggest execution tactics under constraints.
Inputs:
- Allowed proposals
- Orderbook state
Outputs:
- Child-order plan suggestions
Forbidden:
- No bypass of OMS/risk gate

### 1.4 ops-agent
Purpose: Detect incidents and suggest remediation steps.
Inputs:
- Logs, traces, metrics, service state
Outputs:
- Incident summaries + runbook action recommendations
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
- `stream.read.obfuscated.realtime`
- `command.status`
- `command.explain.redacted`

### 2.3 integration-agent
Tier: 2+ and whitelist
Capabilities:
- `plugin.submit`
- `plugin.health.read`

## 3. Shared schemas

```ts
import { z } from "zod";

export const StrategyProposalSchema = z.object({
  proposalId: z.string(),
  cycleId: z.string(),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  actions: z.array(
    z.object({
      type: z.enum(["ENTER", "EXIT", "REBALANCE", "HOLD"]),
      legs: z.array(
        z.object({
          symbol: z.string(),
          side: z.enum(["BUY", "SELL"]),
          notionalUsd: z.number().positive()
        })
      ),
      rationale: z.string().min(1)
    })
  )
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
