// Template for the operator-owned wiring file.
//
//   cp apps/oracle/wiring.template.ts apps/oracle/wiring.ts
//   $EDITOR apps/oracle/wiring.ts   # gitignored — implement against your HL access
//
// `wiring.ts` must export `makeMarketProvider` and `makeOrderRouter`. The
// implementations have to talk to Hyperliquid directly (or to whatever
// machinery the operator owns); the framework will not synthesise either.
// main.ts refuses to start until this file exists and exports both.

import type { HlClient } from '@hl/privateer-hl-client'
import type { OrderRouter, OutcomeMarketProvider } from './src'

export function makeMarketProvider(_hl: HlClient): OutcomeMarketProvider {
  throw new Error(
    'apps/oracle/wiring.ts: makeMarketProvider not implemented. Copy this template and wire to HL HIP-4 info.'
  )
}

export function makeOrderRouter(_hl: HlClient): OrderRouter {
  throw new Error(
    'apps/oracle/wiring.ts: makeOrderRouter not implemented. Copy this template and wire to HL HIP-4 orders.'
  )
}
