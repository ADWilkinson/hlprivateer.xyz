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
- Secret material is loaded via `*_FILE` paths (and can be mounted via systemd credentials).
- Optional hardening: SOPS/age workflows exist under `scripts/secrets/`, but are not required by the current reference deployment.

## AuthN/AuthZ
- Operator auth with MFA and short-lived JWT.
- Service-to-service auth with signed service tokens.
- External agents use API key + entitlement token (and payment proof where required).

## ERC-8004 Feedback Wallet
- **Purpose**: Submits on-chain reputation feedback to the ERC-8004 Reputation Registry after x402 settlements.
- **Key management**: Loaded via `ERC8004_FEEDBACK_PRIVATE_KEY_FILE` (follows the existing `*_FILE` secret pattern).
- **Separation**: This is a hot wallet with minimal ETH for gas only. It is separate from the trading wallet (`HL_PRIVATE_KEY`) and the x402 receiving address (`X402_PAYTO`), though they can share the same address if desired.
- **Risk**: Compromise of this key allows submitting fake feedback. It does not grant access to trading funds or USDC.
- **Rotation**: Generate a new key, update `ERC8004_FEEDBACK_PRIVATE_KEY_FILE`, transfer NFT ownership if needed via the Identity Registry, restart API.

## Key rotation policy
- JWT signing keys: every 30 days.
- Hyperliquid key: quarterly or immediately on suspicion.
- API keys: revocable at any time; default max TTL 90 days.
- ERC-8004 feedback wallet: rotate on suspicion. Low-risk (gas-only wallet, no trading funds).
- Credential rotation process:
  - Default (recommended): rotate the `*_FILE` secret files referenced by `config/.env`, then restart services.
  - Optional (hardened): manage encrypted secret material in git via SOPS/age, and deploy decrypted credentials through systemd:
    - create plaintext source at `config/secrets.prod.plain.yaml` from example.
    - re-encrypt with `bun run secrets:rotate` (requires `SOPS_AGE_RECIPIENT`).
    - deploy target files with `bun run secrets:decrypt`.

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
