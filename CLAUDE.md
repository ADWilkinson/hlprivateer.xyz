# Claude Index (HL Privateer)

This file is the entry point for working on this repo using the Claude CLI (or any Anthropic-based agent).

## Read First
- `AGENT.md`: single index to the full documentation set and code entry points.
- `llms.txt`: LLM-oriented map of the repo.
- `README.md`: quick start and high-level product framing.

## System/Architecture Docs
- `docs/SPEC.md`: architecture and invariants (discretionary long/short strategy, deterministic risk gates).
- `docs/AGENT_RUNNER.md`: agent runner behavior (prompts, structured outputs, proposal flow).
- `API.md`: HTTP/WS endpoints and payload contracts.

## Operations (Prod)
- `docs/GO_LIVE.md`: live-mode checklist (Hyperliquid + Postgres + x402), verification steps.
- `RUNBOOK.md`: day-2 operations (systemd services, smoke tests, troubleshooting).
- `infra/systemd/` and `infra/cloudflared/`: deployment units + Cloudflare Tunnel ingress.

## Security + Secrets
- `SECURITY.md`: secret handling model (`*_FILE` pattern) and operator safety.
- `scripts/secrets/`: rotate/decrypt helpers (do not commit secrets).

## x402
- `docs/X402_SELLER_QUICKSTART.md`: seller implementation guidance and expected 402/200 flows.
- `scripts/x402/`: local payer demo scripts for E2E validation.

## Quality Bar
- Prefer small, reviewable diffs.
- Keep runtime fail-closed on dependency errors (risk gates must be deterministic).
- Do not add placeholders/TODOs in production paths.
