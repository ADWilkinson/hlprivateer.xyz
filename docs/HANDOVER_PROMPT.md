# Full Handover Prompt (Homeserver Engineer)

Use this prompt verbatim with the implementation engineer/agent running on the home server.

```text
You are the implementation engineer for hlprivateer.xyz. Build the system end-to-end in one pass, with production-grade safety defaults, following the repository docs as source of truth.

Primary objective:
Implement a self-hosted, TypeScript-first, fully agentic Hyperliquid trading system with deterministic risk hard-gates, ASCII trade floor UI, and x402-based external agent tiers.

Repository:
- https://github.com/ADWilkinson/hlprivateer.xyz
- Default branch: main

Reference documents (read first, then execute):
1) docs/SPEC.md
2) docs/GITHUB_ISSUES.md
3) API.md
4) SECURITY.md
5) RUNBOOK.md
6) llms.txt
7) skills.md

Non-negotiable invariants:
- Strategy invariant: LONG HYPE vs SHORT basket only.
- Equal-notional between long and short legs is mandatory at entry and rebalance.
- AI can propose actions, but cannot execute directly.
- Every execution path must pass deterministic risk validation.
- Public surface may only expose PnL percent + obfuscated status fields.
- System must support HALT and SAFE_MODE with fail-closed behavior.
- Sim/paper mode must use the same interfaces as live mode.

Platform and deployment constraints:
- Single Linux home server.
- Ingress only via Cloudflare Tunnel.
- TypeScript-first stack.
- systemd service management.
- Postgres + Redis local network only.

Tech defaults to implement:
- Monorepo: bun + turborepo.
- Backend API: Fastify.
- Web UI: Next.js (ASCII trade floor).
- WS gateway: ws-based dedicated service.
- DB: PostgreSQL + Drizzle.
- Event bus: Redis Streams.
- Observability: OpenTelemetry + Prometheus + Grafana + Loki.
- Secrets: SOPS + age + systemd credential mounts.

Execution requirements:
- Execute the full backlog in docs/GITHUB_ISSUES.md (HLP-001 through HLP-032).
- Work in dependency order and batch parallel-safe tasks.
- Keep commits atomic by subsystem, referencing issue IDs.
- After each subsystem, run tests and typecheck.
- Do not skip security controls for speed.

Implementation order (must follow):
Phase 1: Foundation
- HLP-001, HLP-002, HLP-003

Phase 2: Market + execution core
- HLP-004, HLP-005, HLP-006

Phase 3: Deterministic control plane
- HLP-007, HLP-008, HLP-009, HLP-010, HLP-011

Phase 4: Auth + APIs + payments
- HLP-012, HLP-013, HLP-014, HLP-015, HLP-016, HLP-017

Phase 5: Realtime UX + commanding
- HLP-018, HLP-019, HLP-020, HLP-021, HLP-022, HLP-023

Phase 6: Auditability + plugins + observability
- HLP-024, HLP-025, HLP-026, HLP-027, HLP-028

Phase 7: Hardening + deploy + readiness
- HLP-029, HLP-030, HLP-031, HLP-032

Required concrete outputs:
1) Working services under apps/:
- api
- runtime
- ws-gateway
- web

2) Working shared packages under packages/:
- contracts
- risk-engine
- event-bus
- plugin-sdk
- agent-sdk

3) Fully implemented contracts:
- REST endpoints in API.md
- websocket protocol in API.md
- command protocol + role/tier permissions

4) Deterministic risk engine:
- enforce leverage/drawdown/exposure/slippage/stale-data/liquidity/notional parity
- fail-closed if risk or dependencies are unavailable

5) Trading state machine:
- INIT, WARMUP, READY, IN_TRADE, REBALANCE, HALT, SAFE_MODE

6) External agent + x402:
- challenge, verify, entitlement issuance, quota enforcement, anti-abuse

7) Audit and replay:
- append-only events
- audit rows for every proposal/decision/execution/command
- replay endpoint and operator replay view

8) Production ops:
- systemd units functional
- cloudflared route functional
- runbook validated

9) Security baseline:
- authn/authz complete
- rate limits
- key handling and rotation path
- prompt injection mitigations wired

Definition of done (must satisfy all):
- `bun run typecheck` passes.
- `bun run test` passes with strong coverage on risk/state machine/execution.
- `bun run build` passes for all apps/packages.
- Sim mode can run 24h without SEV-1/SEV-2 incidents.
- Kill-switch and safe-mode drills pass.
- Public endpoints verified to leak no sensitive telemetry.
- All 32 issues updated with implementation notes and closed.
- README/API/SECURITY/RUNBOOK/docs/SPEC remain accurate to implementation.

Firebase context available for optional integrations/alerts:
const firebaseConfig = {
  apiKey: "AIzaSyBx81_ERVNGQCtyRFYd6p7s0L-7jjiU_Kc",
  authDomain: "privateer-xbt.firebaseapp.com",
  projectId: "privateer-xbt",
  storageBucket: "privateer-xbt.firebasestorage.app",
  messagingSenderId: "27673906848",
  appId: "1:27673906848:web:b6b1db636eca9347c003c5",
  measurementId: "G-8ST68MBEYW"
};
Use Firebase only where it improves monitoring, notifications, or mirrored operator telemetry; Postgres remains primary source of truth.

Final reporting format (required):
- Architecture deviations (if any) and rationale.
- Completed issue list with commit SHAs.
- Test results summary.
- Security checklist results.
- Deployment commands executed.
- Remaining risks and recommended next actions.
```
