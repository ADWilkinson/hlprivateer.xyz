# Agent Index (HL Privateer)

This file is the "start here" index for any LLM/agent working in this repo.

## Primary Docs
- `README.md`: product overview + quick start.
- `docs/SPEC.md`: full architecture/spec for the trading system (runtime, risk gates, event bus).
- `docs/AGENT_RUNNER.md`: how the agent-runner works (LLMs, prompts, proposal schema, publish flow).
- `API.md`: HTTP + WS API surface (public + operator + agent endpoints).
- `docs/GO_LIVE.md`: live-trading + x402 go-live checklist (production operations).

## Ops + Security
- `RUNBOOK.md`: operational runbook (services, restarts, smoke tests, troubleshooting).
- `infra/systemd/`: systemd units for api/ws/runtime/agent-runner/cloudflared.
- `infra/cloudflared/`: Cloudflare Tunnel configuration and examples.
- `SECURITY.md`: threat model, secret handling, reporting.

## x402 (Paid Agent Endpoints)
- `docs/X402_SELLER_QUICKSTART.md`: concrete seller quickstart and verification steps.
- `scripts/x402/`: local demo payer scripts for end-to-end validation.

## Repo Navigation For Agents
- `llms.txt`: short, high-signal map of the repo for LLMs.
- `skills.md`: agent skill contracts used in this workspace.
- `docs/HANDOVER_PROMPT.md`: deep engineer handover prompt (useful for onboarding new agents).
- `docs/GITHUB_ISSUES.md`: issue hygiene and project tracking conventions.

## Code Entry Points
- Runtime orchestrator (strategy loop + risk gates): `apps/runtime/src/orchestrator/state.ts`
- Live OMS adapter (Hyperliquid execution + account value): `apps/runtime/src/services/oms.ts`
- Agent runner (LLM calls, proposal publishing): `apps/agent-runner/src/index.ts`
- API server (public + operator + agent routes): `apps/api/src/index.ts`
- WS gateway: `apps/ws-gateway/src/index.ts`
- Web UI: `apps/web/`

## Common Commands
- Install: `bun install`
- Dev (local): `bun run dev`
- Build: `bun run build`
- Tests: `bun run test`
- Local + public smoke: `LOCAL=1 bash scripts/readiness/smoke.sh`

