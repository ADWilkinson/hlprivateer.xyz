# Web UI - Development Context

## Overview
Next.js 15 application with ASCII/terminal aesthetic serving the operator dashboard and public landing page. Static export for Cloudflare Pages or standalone mode.

## Stack
- **Framework**: Next.js 15.1.7 (App Router)
- **React**: 19.0.0
- **Styling**: Tailwind CSS 3.4.17
- **Font**: IBM Plex Mono (monospace throughout)
- **Build**: Static export (`HLP_STATIC_EXPORT=1`) or standalone

## Routing
```
app/
├── layout.tsx              # Root layout with font + SiteNav
├── page.tsx                # Landing: live PnL sparklines, floor snapshot polling
├── globals.css             # Tailwind + ASCII texture utilities
├── data/page.tsx           # Live operator dashboard (WebSocket)
├── crew/page.tsx           # Crew architecture docs
├── integrations/page.tsx   # Data source map
└── tape/page.tsx           # Event tape stream
```

## Key Pages

**Landing (`/`)**: Public page with live PnL snapshot cards, leverage and sharpe telemetry. Polls `/v1/public/floor-snapshot` every 12s. LocalStorage-backed time series (max 240 points).

**Floor Dashboard (`/floor`)**: Mobile-first operator interface with compact defaults for noncritical sections and compact-aware positions/tape/pnl rendering (`PositionsTable`, `TapeSection`, `PnlPanel`). WebSocket connection to `ws.hlprivateer.xyz`. Collapsible sections: status, positions, pnl, performance, crew, intelligence, tape, x402.

## UI Components (`app/ui/`)
- `ascii-style.ts`: Design tokens (`pageShellClass`, `cardClass`, `cardHeaderClass`, etc.)
- `AsciiBackground.tsx`: Animated ASCII grid (160x60, 80ms tick)
- `AsciiDivider.tsx`: Wave/dots/boxes divider variants
- `LandingAsciiDisplay.tsx`: Generative 16-segment matrix
- `ascii-kit.tsx`: `AsciiBadge` (square/angle/curly), `AsciiTable` (striped)
- `StatusStrip.tsx`, `PnlPanel.tsx`, `CrewStationsPanel.tsx`, `TapeSection.tsx`
- `floor-dashboard.ts`: Shared types + normalization utils

## Styling
**Tailwind palette**: `hlpBg`, `hlpPanel`, `hlpFg`, `hlpMuted`, `hlpPositive`, `hlpNegative`, `hlpAccent` (sky blue)
**Animations**: `hlp-fade-up`, `hlp-hot`, `hlp-led`, `hlp-cursor`, `hlp-scan`, `hlp-wave-scroll`
**Global CSS**: `.ascii-texture` (dot grid), `.scanline-overlay`, `.terminal-glow`, custom scrollbar

## Data Fetching
- `lib/endpoints.ts`: Auto-detects localhost vs production
- Landing: `fetch` polling (12s interval)
- Dashboard: WebSocket with auto-reconnect (1.5s delay), envelope unwrapping, heartbeat tracking

## Constraints
- No SSR for dynamic data (all client-fetched)
- No external state library (React state + refs only)
- ASCII aesthetic is non-negotiable (monospace, borders, terminal vibes)
- Read-only dashboard (no user input forms)
- Minimal external deps (no UI library beyond Next.js)

## Build & Deploy
```bash
bun dev           # Dev server on :3000
bun run build     # Standalone
bun run build:static  # Static export (HLP_STATIC_EXPORT=1)
```
Static site deployed to Cloudflare Pages via `deploy:web:cloudflare` root script.

## Repository Documentation
- `AGENTS.md`: operational runbook and deployment flow.
- `README.md`: repo overview and setup commands.
- `API.md`: endpoint contracts and x402 pricing.
- `docs/SPEC.md`: architecture and behavioral invariants.
- `RUNBOOK.md`: operational recovery and day-to-day runbook.
- `SECURITY.md`: secret handling and threat model.
