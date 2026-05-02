import type { HlClient } from './index'

export interface ClearinghouseState {
  marginSummary: {
    accountValue: string
    totalNtlPos: string
    totalRawUsd: string
    totalMarginUsed: string
  }
  crossMarginSummary?: {
    accountValue: string
    totalNtlPos: string
    totalRawUsd: string
    totalMarginUsed: string
  }
  withdrawable?: string
  assetPositions: Array<{
    type: string
    position: {
      coin: string
      szi: string
      entryPx?: string
      positionValue?: string
      unrealizedPnl?: string
      returnOnEquity?: string
      leverage?: { type: string; value: number; rawUsd?: string }
      maxLeverage?: number
      cumFunding?: { allTime: string; sinceOpen: string; sinceChange: string }
    }
  }>
}

export interface UserFill {
  coin: string
  px: string
  sz: string
  side: 'A' | 'B'
  time: number
  startPosition?: string
  dir?: string
  closedPnl?: string
  hash?: string
  oid?: number
  crossed?: boolean
  fee?: string
  feeToken?: string
  tid?: number
}

export async function clearinghouseState(
  hl: HlClient,
  user: string
): Promise<ClearinghouseState> {
  return hl.postInfo<ClearinghouseState>({ type: 'clearinghouseState', user })
}

export async function userFills(hl: HlClient, user: string): Promise<UserFill[]> {
  return hl.postInfo<UserFill[]>({ type: 'userFills', user })
}

export async function userFillsByTime(
  hl: HlClient,
  user: string,
  startTime: number
): Promise<UserFill[]> {
  return hl.postInfo<UserFill[]>({ type: 'userFillsByTime', user, startTime })
}

// Account value as a number, sourced from cross-margin if present, else flat
// margin summary. Returns NaN if HL responds with a malformed shape — caller
// decides whether to degrade gracefully.
export function accountValueUsd(state: ClearinghouseState): number {
  const raw = state.crossMarginSummary?.accountValue ?? state.marginSummary?.accountValue
  const n = Number(raw)
  return Number.isFinite(n) ? n : Number.NaN
}
