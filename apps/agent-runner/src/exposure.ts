import type { OperatorPosition } from '@hl/privateer-contracts'

export function meaningfulPositions(positions: OperatorPosition[], thresholdUsd: number): OperatorPosition[] {
  const threshold = Math.max(0, thresholdUsd)
  return positions.filter((position) => Number.isFinite(position.notionalUsd) && Math.abs(position.notionalUsd) >= threshold)
}

export function buildFlatSignature(positions: OperatorPosition[], thresholdUsd: number): string {
  const rows = meaningfulPositions(positions, thresholdUsd)
    .map((position) => ({
      symbol: String(position.symbol).toUpperCase(),
      side: position.side,
      qtyBucket: Number((Math.round(Math.abs(position.qty) * 10000) / 10000).toFixed(4))
    }))
    .sort((a, b) => {
      const symbolCmp = a.symbol.localeCompare(b.symbol)
      if (symbolCmp !== 0) {
        return symbolCmp
      }
      return a.side.localeCompare(b.side)
    })

  if (rows.length === 0) {
    return 'FLAT'
  }

  return rows.map((row) => `${row.symbol}:${row.side}:${row.qtyBucket.toFixed(4)}`).join('|')
}

export function hasDustOnlyExposure(positions: OperatorPosition[], thresholdUsd: number): boolean {
  if (positions.length === 0) {
    return false
  }

  const threshold = Math.max(0, thresholdUsd)
  const hasMeaningful = positions.some((position) => Number.isFinite(position.notionalUsd) && Math.abs(position.notionalUsd) >= threshold)
  if (hasMeaningful) {
    return false
  }

  return positions.some((position) => Number.isFinite(position.notionalUsd) && Math.abs(position.notionalUsd) > 1e-9)
}

