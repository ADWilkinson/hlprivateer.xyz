# SECURITY.md

## Security posture summary
HL Privateer is security-sensitive trading infrastructure. Risk and security controls default to fail-closed behavior.

## Threat model (high level)
Assets:
- Trading keys
- Operator accounts
- Risk configs and strategy state
- Execution records and audit logs

Adversaries:
- Public internet attackers
- Malicious external agents
- Prompt-injection content from feeds/plugins
- Compromised operator session

Attack surfaces:
- REST API and websocket endpoints
- Plugin runtime
- Secret storage paths
- CI/deployment pipeline

## Core safeguards
- Deterministic risk engine hard-gate before execution.
- Kill switch and safe mode available via operator admin only.
- Public surface limited to PnL percent and obfuscated metadata.
- External agents gated by tier entitlements and x402 verification.
- Secret material managed via SOPS/age + systemd credentials.

## AuthN/AuthZ
- Operator auth with MFA and short-lived JWT.
- Service-to-service auth with signed service tokens.
- External agents use API key + entitlement token (and payment proof where required).

## Key rotation policy
- JWT signing keys: every 30 days.
- Hyperliquid key: quarterly or immediately on suspicion.
- API keys: revocable at any time; default max TTL 90 days.

## Security reporting
If you discover a vulnerability:
- Email: `security@hlprivateer.xyz` (planned)
- Include reproduction steps and impact.
- Do not disclose publicly before coordinated fix.

## Incident severity guide
- SEV-1: potential key compromise, unauthorized execution, critical data leak.
- SEV-2: auth bypass without execution, sustained service outage.
- SEV-3: low-impact bug or defense-in-depth weakness.

## Scope exclusions
- No bug bounty at this stage.
- Non-production branches may not represent live posture.
